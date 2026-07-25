// §10.3: minimum stated age is 13; only month/year are collected (never a
// full birth date), so age is computed to the precision that data allows.
// Shared by the sign-in screen's registration form and the end-of-match
// guest upgrade card, which apply the same gate.
export const MINIMUM_ACCOUNT_AGE = 13;

export function ageInYears(birthYear: number, birthMonth: number): number {
  const now = new Date();
  let age = now.getFullYear() - birthYear;
  if (now.getMonth() + 1 < birthMonth) {
    age -= 1;
  }
  return age;
}
