/** Shared contact-number rules for the whole product. */
export const NATIONAL_NUMBER_LENGTH = 10;
export const DEFAULT_COUNTRY_DIAL_CODE = "91";

export type CountryDialCode = {
  code: string;
  name: string;
  iso2: string;
};

/**
 * Dial codes offered in the contact-number dropdown.
 * Sorted with India first; remaining entries alphabetical by country name.
 */
export const COUNTRY_DIAL_CODES: readonly CountryDialCode[] = [
  { code: "91", name: "India", iso2: "IN" },
  { code: "61", name: "Australia", iso2: "AU" },
  { code: "880", name: "Bangladesh", iso2: "BD" },
  { code: "55", name: "Brazil", iso2: "BR" },
  { code: "1", name: "Canada", iso2: "CA" },
  { code: "86", name: "China", iso2: "CN" },
  { code: "33", name: "France", iso2: "FR" },
  { code: "49", name: "Germany", iso2: "DE" },
  { code: "852", name: "Hong Kong", iso2: "HK" },
  { code: "62", name: "Indonesia", iso2: "ID" },
  { code: "39", name: "Italy", iso2: "IT" },
  { code: "81", name: "Japan", iso2: "JP" },
  { code: "254", name: "Kenya", iso2: "KE" },
  { code: "60", name: "Malaysia", iso2: "MY" },
  { code: "52", name: "Mexico", iso2: "MX" },
  { code: "977", name: "Nepal", iso2: "NP" },
  { code: "64", name: "New Zealand", iso2: "NZ" },
  { code: "234", name: "Nigeria", iso2: "NG" },
  { code: "92", name: "Pakistan", iso2: "PK" },
  { code: "63", name: "Philippines", iso2: "PH" },
  { code: "65", name: "Singapore", iso2: "SG" },
  { code: "27", name: "South Africa", iso2: "ZA" },
  { code: "82", name: "South Korea", iso2: "KR" },
  { code: "94", name: "Sri Lanka", iso2: "LK" },
  { code: "46", name: "Sweden", iso2: "SE" },
  { code: "41", name: "Switzerland", iso2: "CH" },
  { code: "66", name: "Thailand", iso2: "TH" },
  { code: "971", name: "United Arab Emirates", iso2: "AE" },
  { code: "44", name: "United Kingdom", iso2: "GB" },
  { code: "1", name: "United States", iso2: "US" },
] as const;

const DIAL_CODES_BY_LENGTH_DESC = Array.from(
  new Set(COUNTRY_DIAL_CODES.map((country) => country.code)),
).sort((a, b) => b.length - a.length || a.localeCompare(b));

const KNOWN_DIAL_CODES = new Set(DIAL_CODES_BY_LENGTH_DESC);

export const PHONE_VALIDATION_MESSAGE =
  "Select a country code and enter exactly 10 digits.";

/** Keep only digits and cap at the national-number length. */
export function sanitizeNationalNumberInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, NATIONAL_NUMBER_LENGTH);
}

export function isValidNationalNumber(value: string): boolean {
  return new RegExp(`^\\d{${NATIONAL_NUMBER_LENGTH}}$`).test(value);
}

export function isKnownDialCode(code: string): boolean {
  return KNOWN_DIAL_CODES.has(code);
}

/** Canonical storage shape: +{dialCode}{10 digits}. */
export function composePhoneNumber(
  dialCode: string,
  nationalNumber: string,
): string {
  const code = dialCode.replace(/\D/g, "");
  const national = sanitizeNationalNumberInput(nationalNumber);
  if (!code || !national) return "";
  return `+${code}${national}`;
}

export type ParsedPhoneNumber = {
  dialCode: string;
  nationalNumber: string;
};

/**
 * Split a stored/composed phone into dial code + national digits.
 * Bare 10-digit values are treated as the default country (India).
 */
export function parsePhoneNumber(value: string): ParsedPhoneNumber {
  const compact = value.trim().replace(/[\s\-().]/g, "");

  if (!compact) {
    return {
      dialCode: DEFAULT_COUNTRY_DIAL_CODE,
      nationalNumber: "",
    };
  }

  if (!compact.startsWith("+")) {
    const digits = compact.replace(/\D/g, "");
    return {
      dialCode: DEFAULT_COUNTRY_DIAL_CODE,
      nationalNumber: sanitizeNationalNumberInput(digits),
    };
  }

  const rest = compact.slice(1).replace(/\D/g, "");
  for (const code of DIAL_CODES_BY_LENGTH_DESC) {
    if (rest.startsWith(code)) {
      return {
        dialCode: code,
        nationalNumber: sanitizeNationalNumberInput(rest.slice(code.length)),
      };
    }
  }

  return {
    dialCode: DEFAULT_COUNTRY_DIAL_CODE,
    nationalNumber: sanitizeNationalNumberInput(rest),
  };
}

/**
 * Valid contact numbers are exactly: +{known dial code}{10 digits}.
 * Spaces, dashes, letters, and other lengths are rejected.
 */
export function isValidPhoneNumber(value: string): boolean {
  return normalizePhoneNumber(value) !== null;
}

/** Return canonical +{dial}{10digits}, or null when invalid. */
export function normalizePhoneNumber(value: string): string | null {
  const compact = value.trim().replace(/[\s\-().]/g, "");
  if (!compact.startsWith("+")) return null;

  const rest = compact.slice(1);
  if (!/^\d+$/.test(rest)) return null;

  for (const code of DIAL_CODES_BY_LENGTH_DESC) {
    if (!rest.startsWith(code)) continue;
    const national = rest.slice(code.length);
    if (!isValidNationalNumber(national)) return null;
    return `+${code}${national}`;
  }

  return null;
}

export function countryOptionLabel(country: CountryDialCode): string {
  return `${country.iso2} +${country.code}`;
}
