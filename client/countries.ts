// §3.3: "Closed Beta markets are the United States, Canada excluding
// Quebec, and Taiwan." AGS IAM's EMAILPASSWD registration requires an
// ISO 3166-1 alpha-2 country code; scoped to the three documented launch
// markets rather than a full global list, which would be premature before
// Version 1's wider availability is approved.
export interface CountryOption {
  code: string;
  name: string;
}

export const CLOSED_BETA_COUNTRIES: CountryOption[] = [
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "TW", name: "Taiwan" },
];

export const DEFAULT_COUNTRY_CODE = "US";
