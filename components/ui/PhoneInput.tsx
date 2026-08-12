"use client";

import {
  COUNTRY_DIAL_CODES,
  DEFAULT_COUNTRY_DIAL_CODE,
  NATIONAL_NUMBER_LENGTH,
  composePhoneNumber,
  countryOptionLabel,
  parsePhoneNumber,
  sanitizeNationalNumberInput,
} from "@/lib/phone";
import { useId, useState } from "react";

type PhoneInputProps = {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  className?: string;
  selectClassName?: string;
  inputClassName?: string;
  "aria-describedby"?: string;
};

function countryKey(iso2: string, code: string): string {
  return `${iso2}:${code}`;
}

function dialCodeFromKey(key: string): string {
  const separator = key.indexOf(":");
  return separator === -1 ? key : key.slice(separator + 1);
}

function defaultCountryKeyForDialCode(dialCode: string): string {
  const match = COUNTRY_DIAL_CODES.find((country) => country.code === dialCode);
  if (match) return countryKey(match.iso2, match.code);
  return countryKey("IN", DEFAULT_COUNTRY_DIAL_CODE);
}

/**
 * Product-wide contact number control: country dial-code dropdown +
 * exactly 10 national digits. Emits canonical `+{dial}{10digits}` (or "").
 */
export default function PhoneInput({
  id,
  name,
  value,
  onChange,
  disabled = false,
  required = false,
  invalid = false,
  className,
  selectClassName,
  inputClassName,
  "aria-describedby": ariaDescribedBy,
}: PhoneInputProps) {
  const generatedId = useId();
  const numberId = id ?? `${generatedId}-number`;
  const countryId = `${numberId}-country`;

  const parsed = parsePhoneNumber(value);
  const [countrySelection, setCountrySelection] = useState(
    defaultCountryKeyForDialCode(parsed.dialCode || DEFAULT_COUNTRY_DIAL_CODE),
  );
  const [nationalNumber, setNationalNumber] = useState(parsed.nationalNumber);
  const [syncedValue, setSyncedValue] = useState(value);

  // Reconcile local draft state when the parent value changes (e.g. form reset).
  if (value !== syncedValue) {
    setSyncedValue(value);
    const next = parsePhoneNumber(value);
    const nextCountry = defaultCountryKeyForDialCode(
      next.dialCode || DEFAULT_COUNTRY_DIAL_CODE,
    );
    const currentDial = dialCodeFromKey(countrySelection);
    if (currentDial !== next.dialCode) {
      setCountrySelection(nextCountry);
    }
    setNationalNumber(next.nationalNumber);
  }

  function emit(nextDial: string, nextNational: string) {
    if (!nextNational) {
      onChange("");
      return;
    }
    onChange(composePhoneNumber(nextDial, nextNational));
  }

  return (
    <div className={className ? `flex gap-2 ${className}` : "flex gap-2"}>
      <label htmlFor={countryId} className="sr-only">
        Country code
      </label>
      <select
        id={countryId}
        disabled={disabled}
        value={countrySelection}
        onChange={(event) => {
          const nextKey = event.target.value;
          const nextDial = dialCodeFromKey(nextKey);
          setCountrySelection(nextKey);
          emit(nextDial, nationalNumber);
        }}
        className={
          selectClassName ??
          "w-[7.5rem] shrink-0 rounded-md border border-border bg-surface px-2 py-2 text-sm text-foreground outline-none transition focus:border-accent disabled:opacity-70"
        }
        aria-invalid={invalid}
      >
        {COUNTRY_DIAL_CODES.map((country) => (
          <option
            key={countryKey(country.iso2, country.code)}
            value={countryKey(country.iso2, country.code)}
          >
            {countryOptionLabel(country)}
          </option>
        ))}
      </select>

      <input
        id={numberId}
        name={name}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        required={required}
        disabled={disabled}
        value={nationalNumber}
        maxLength={NATIONAL_NUMBER_LENGTH}
        placeholder="10-digit number"
        aria-invalid={invalid}
        aria-describedby={ariaDescribedBy}
        onChange={(event) => {
          const nextNational = sanitizeNationalNumberInput(event.target.value);
          setNationalNumber(nextNational);
          emit(dialCodeFromKey(countrySelection), nextNational);
        }}
        className={
          inputClassName ??
          "min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent disabled:opacity-70"
        }
      />
    </div>
  );
}
