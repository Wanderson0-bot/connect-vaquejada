import { useEffect, useRef, useState } from "react";

export const BRAZILIAN_STATES = [
  ["AC", "Acre"],
  ["AL", "Alagoas"],
  ["AP", "Amapá"],
  ["AM", "Amazonas"],
  ["BA", "Bahia"],
  ["CE", "Ceará"],
  ["DF", "Distrito Federal"],
  ["ES", "Espírito Santo"],
  ["GO", "Goiás"],
  ["MA", "Maranhão"],
  ["MT", "Mato Grosso"],
  ["MS", "Mato Grosso do Sul"],
  ["MG", "Minas Gerais"],
  ["PA", "Pará"],
  ["PB", "Paraíba"],
  ["PR", "Paraná"],
  ["PE", "Pernambuco"],
  ["PI", "Piauí"],
  ["RJ", "Rio de Janeiro"],
  ["RN", "Rio Grande do Norte"],
  ["RS", "Rio Grande do Sul"],
  ["RO", "Rondônia"],
  ["RR", "Roraima"],
  ["SC", "Santa Catarina"],
  ["SP", "São Paulo"],
  ["SE", "Sergipe"],
  ["TO", "Tocantins"],
] as const;

const DEFAULT_DDD_BY_STATE: Record<string, string> = {
  AC: "68", AL: "82", AP: "96", AM: "92", BA: "71", CE: "85", DF: "61",
  ES: "27", GO: "62", MA: "98", MT: "65", MS: "67", MG: "31", PA: "91",
  PB: "83", PR: "41", PE: "81", PI: "86", RJ: "21", RN: "84", RS: "51",
  RO: "69", RR: "95", SC: "48", SP: "11", SE: "79", TO: "63",
};

export function BrazilianStateOptions() {
  return BRAZILIAN_STATES.map(([uf, name]) => (
    <option key={uf} value={uf}>{uf} — {name}</option>
  ));
}

export function BrazilianPhoneInput({
  name = "phone",
  defaultValue,
  required = false,
  state = "",
}: {
  name?: string;
  defaultValue?: string;
  required?: boolean;
  state?: string;
}) {
  const initialDigits = (defaultValue || "").replace(/\D/g, "");
  const initialNationalDigits = initialDigits.startsWith("55") && initialDigits.length >= 13
    ? initialDigits.slice(2)
    : initialDigits;
  const initialDdd = initialNationalDigits.length > 9
    ? initialNationalDigits.slice(0, 2)
    : DEFAULT_DDD_BY_STATE[state] || "";
  const initialLocalNumber = initialNationalDigits.length > 9
    ? initialNationalDigits.slice(2, 11)
    : initialNationalDigits.slice(-9);
  const [ddd, setDdd] = useState(initialDdd);
  const [localNumber, setLocalNumber] = useState(initialLocalNumber);
  const previousState = useRef(state);

  useEffect(() => {
    if (previousState.current !== state) {
      setDdd(DEFAULT_DDD_BY_STATE[state] || "");
      previousState.current = state;
    }
  }, [state]);

  const value = `+55 ${ddd} ${localNumber}`;
  const phone = `+55${ddd}${localNumber}`;

  return (
    <>
      <input type="hidden" name={name} value={phone} />
      <input
        type="tel"
        inputMode="tel"
        pattern="\+55 [0-9]{2} [0-9]{9}"
        maxLength={16}
        placeholder="+55 11 999999999"
        title="Informe o telefone completo com +55, DDD e 9 dígitos."
        required={required}
        value={value}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "");
          const currentPrefix = `55${ddd}`;
          if (ddd.length === 2 && digits.startsWith(currentPrefix)) {
            setLocalNumber(digits.slice(currentPrefix.length, currentPrefix.length + 9));
          } else if (!digits.startsWith("55") && digits.length <= 9) {
            setDdd(DEFAULT_DDD_BY_STATE[state] || "");
            setLocalNumber(digits);
          } else if (digits.startsWith("55") && digits.slice(2).length < 2) {
            setDdd(DEFAULT_DDD_BY_STATE[state] || "");
            setLocalNumber(digits.slice(2));
          } else {
            const nationalDigits = digits.startsWith("55") ? digits.slice(2) : digits;
            setDdd(nationalDigits.slice(0, 2));
            setLocalNumber(nationalDigits.slice(2, 11));
          }
        }}
      />
    </>
  );
}
