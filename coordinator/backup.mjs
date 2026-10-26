import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, lstat, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const backupFormat = "connect-pdm-sqlite-backup";
const backupVersion = 1;
const supportedSchemaVersion = 2;
const countedTables = ["records", "operations", "conflicts", "operation_attempts", "schema_migrations"];

function integrity(db) {
  const integrityRows = db.prepare("PRAGMA integrity_check").all();
  if (integrityRows.length !== 1 || integrityRows[0].integrity_check !== "ok") {
    throw new Error("A verificação PRAGMA integrity_check do banco falhou.");
  }
  if (db.prepare("PRAGMA foreign_key_check").all().length) {
    throw new Error("O banco contém violações de chave estrangeira.");
  }
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
  for (const required of ["records", "operations", "conflicts", "schema_migrations"]) {
    if (!tables.has(required)) throw new Error(`O arquivo não contém a tabela necessária do coordenador: ${required}.`);
  }
  const schemaVersion = Number(db.prepare("PRAGMA user_version").get().user_version);
  if (schemaVersion !== supportedSchemaVersion) {
    throw new Error(`Versão do esquema incompatível: esperado ${supportedSchemaVersion}, encontrado ${schemaVersion}.`);
  }
  const counts = {};
  for (const table of countedTables) {
    counts[table] = tables.has(table) ? Number(db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count) : 0;
  }
  const migrations = db.prepare("SELECT version,name FROM schema_migrations ORDER BY version").all()
    .map((row) => ({ version: Number(row.version), name: String(row.name) }));
  return { schemaVersion, counts, migrations };
}

async function inspectDatabase(filePath) {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    return integrity(db);
  } finally {
    db.close();
  }
}

async function hashFile(filePath) {
  const contents = await readFile(filePath);
  return createHash("sha256").update(contents).digest("hex");
}

async function readManifest(databasePath) {
  const manifestPath = `${databasePath}.manifest.json`;
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Manifesto de backup ausente ou inválido (${basename(manifestPath)}): ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!manifest || manifest.format !== backupFormat || manifest.version !== backupVersion ||
      manifest.databaseFile !== basename(databasePath) || typeof manifest.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(manifest.sha256) || !Number.isFinite(Date.parse(manifest.createdAt)) ||
      typeof manifest.applicationVersion !== "string") {
    throw new Error("O manifesto do backup não corresponde ao formato ou ao arquivo informado.");
  }
  return manifest;
}

export async function createCoordinatorBackup(sourcePath, destinationPath, applicationVersion) {
  const source = resolve(sourcePath);
  const destination = resolve(destinationPath);
  if (source === destination) throw new Error("O destino do backup não pode ser o próprio banco de origem.");
  if (typeof applicationVersion !== "string" || !applicationVersion.trim()) throw new Error("Informe a versão da aplicação para registrar no manifesto.");
  const destinationManifest = `${destination}.manifest.json`;
  const directory = dirname(destination);
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory()) throw new Error("A pasta de destino do backup não é um diretório.");
  for (const output of [destination, destinationManifest]) {
    try {
      await lstat(output);
      throw new Error(`O destino já existe e não será sobrescrito: ${output}`);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code !== "ENOENT") throw error;
      if (error instanceof Error && error.message.startsWith("O destino já existe")) throw error;
    }
  }

  const sourceDb = new DatabaseSync(source, { readOnly: true });
  let snapshot;
  try {
    snapshot = Buffer.from(sourceDb.serialize());
  } finally {
    sourceDb.close();
  }

  const temporaryDatabase = `${destination}.${randomUUID()}.tmp`;
  const temporaryManifest = `${destinationManifest}.${randomUUID()}.tmp`;
  let publishedDatabase = false;
  try {
    await writeFile(temporaryDatabase, snapshot, { flag: "wx", mode: 0o600 });
    const verification = await inspectDatabase(temporaryDatabase);
    const manifest = {
      format: backupFormat,
      version: backupVersion,
      createdAt: new Date().toISOString(),
      applicationVersion: applicationVersion.trim(),
      databaseFile: basename(destination),
      sha256: await hashFile(temporaryDatabase),
      integrity: "ok",
      foreignKeyViolations: 0,
      ...verification,
    };
    await copyFile(temporaryDatabase, destination, fsConstants.COPYFILE_EXCL);
    publishedDatabase = true;
    await rm(temporaryDatabase);
    await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await copyFile(temporaryManifest, destinationManifest, fsConstants.COPYFILE_EXCL);
    await rm(temporaryManifest);
    return manifest;
  } catch (error) {
    await rm(temporaryDatabase, { force: true });
    await rm(temporaryManifest, { force: true });
    if (publishedDatabase) await rm(destination, { force: true });
    throw error;
  }
}

export async function verifyCoordinatorBackup(databasePath) {
  const database = resolve(databasePath);
  const manifest = await readManifest(database);
  const sha256 = await hashFile(database);
  if (sha256 !== manifest.sha256) throw new Error("A soma SHA-256 do banco não corresponde ao manifesto.");
  const verified = await inspectDatabase(database);
  if (manifest.integrity !== "ok" || manifest.foreignKeyViolations !== 0 ||
      manifest.schemaVersion !== verified.schemaVersion ||
      JSON.stringify(manifest.counts) !== JSON.stringify(verified.counts) ||
      JSON.stringify(manifest.migrations) !== JSON.stringify(verified.migrations)) {
    throw new Error("A integridade, as contagens ou as migrações do banco diferem do manifesto.");
  }
  return manifest;
}

export async function restoreCoordinatorBackup(backupPath, destinationPath) {
  const source = resolve(backupPath);
  const destination = resolve(destinationPath);
  if (source === destination) throw new Error("A restauração deve usar um caminho isolado, diferente do backup.");
  const manifest = await verifyCoordinatorBackup(source);
  await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
  try {
    const restored = await inspectDatabase(destination);
    if (JSON.stringify(restored.counts) !== JSON.stringify(manifest.counts) ||
        restored.schemaVersion !== manifest.schemaVersion ||
        JSON.stringify(restored.migrations) !== JSON.stringify(manifest.migrations)) {
      throw new Error("A instância restaurada não corresponde às verificações do backup.");
    }
    return { destination, ...restored };
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  }
}

async function applicationVersion() {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  if (typeof packageJson.version !== "string") throw new Error("A versão da aplicação não está definida em package.json.");
  return packageJson.version;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === "backup") {
      if (args.length < 1 || args.length > 2) throw new Error("Uso: node coordinator/backup.mjs backup <backup.sqlite> ou backup <banco.sqlite> <backup.sqlite>");
      const source = args.length === 2 ? args[0] : process.env.CONNECT_PDM_DB || resolve("data/connect-pdm.sqlite");
      const destination = args.length === 2 ? args[1] : args[0];
      console.log(JSON.stringify(await createCoordinatorBackup(source, destination, await applicationVersion()), null, 2));
    } else if (command === "verify") {
      if (!args[0]) throw new Error("Uso: node coordinator/backup.mjs verify <backup.sqlite>");
      console.log(JSON.stringify(await verifyCoordinatorBackup(args[0]), null, 2));
    } else if (command === "restore") {
      if (!args[0] || !args[1]) throw new Error("Uso: node coordinator/backup.mjs restore <backup.sqlite> <nova-instancia.sqlite>");
      console.log(JSON.stringify(await restoreCoordinatorBackup(args[0], args[1]), null, 2));
    } else {
      throw new Error("Comando inválido. Use backup, verify ou restore.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
