/**
 * The password rules Clerk enforces server-side, mirrored so the form can show them BEFORE the
 * rejection. Read at runtime from the loaded Clerk client's environment; these defaults are the
 * consl production instance's settings as of 2026-09-16 (min 8, strength ≥ 2 of 4, breached
 * passwords refused, no character-class rules) and only matter if that read ever fails.
 */

export type PasswordSettings = {
  minLength: number;
  maxLength: number;
  requireLowercase: boolean;
  requireUppercase: boolean;
  requireNumbers: boolean;
  requireSpecial: boolean;
  allowedSpecial: string;
  /** zxcvbn score 0–4 a password must reach; 0 = strength not enforced. */
  minStrength: number;
};

export const DEFAULT_PASSWORD_SETTINGS: PasswordSettings = {
  minLength: 8,
  maxLength: 72,
  requireLowercase: false,
  requireUppercase: false,
  requireNumbers: false,
  requireSpecial: false,
  allowedSpecial: "!\"#$%&'()*+,-./:;<=>?@[]^_`{|}~",
  minStrength: 2,
};

/** Clerk's environment payload uses snake_case and 0 for "use the default". */
export function normalizePasswordSettings(raw: unknown): PasswordSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_PASSWORD_SETTINGS;
  const r = raw as Record<string, unknown>;
  const num = (k: string, d: number) => (typeof r[k] === "number" && (r[k] as number) > 0 ? (r[k] as number) : d);
  const bool = (k: string) => r[k] === true;
  return {
    minLength: num("min_length", DEFAULT_PASSWORD_SETTINGS.minLength),
    maxLength: num("max_length", DEFAULT_PASSWORD_SETTINGS.maxLength),
    requireLowercase: bool("require_lowercase"),
    requireUppercase: bool("require_uppercase"),
    requireNumbers: bool("require_numbers"),
    requireSpecial: bool("require_special_char"),
    allowedSpecial:
      typeof r.allowed_special_characters === "string" && r.allowed_special_characters
        ? r.allowed_special_characters
        : DEFAULT_PASSWORD_SETTINGS.allowedSpecial,
    minStrength: typeof r.min_zxcvbn_strength === "number" ? r.min_zxcvbn_strength : DEFAULT_PASSWORD_SETTINGS.minStrength,
  };
}

export type Strength = { score: number; warning: string | null; suggestions: string[] };

/** One line of the checklist. `met` is null while the strength library is still loading. */
export type Rule = { key: string; label: string; met: boolean | null; hint?: string };

const STRENGTH_HINT = "No common words, names or patterns like 1234.";

export function passwordRules(pw: string, s: PasswordSettings, strength: Strength | null): Rule[] {
  const rules: Rule[] = [{ key: "length", label: `At least ${s.minLength} characters`, met: pw.length >= s.minLength }];
  if (s.requireLowercase) rules.push({ key: "lower", label: "A lowercase letter", met: /[a-z]/.test(pw) });
  if (s.requireUppercase) rules.push({ key: "upper", label: "An uppercase letter", met: /[A-Z]/.test(pw) });
  if (s.requireNumbers) rules.push({ key: "number", label: "A number", met: /\d/.test(pw) });
  if (s.requireSpecial) {
    rules.push({ key: "special", label: "A special character", met: [...pw].some((c) => s.allowedSpecial.includes(c)) });
  }
  if (s.minStrength > 0) {
    const met = pw ? (strength ? strength.score >= s.minStrength : null) : false;
    const failing = pw && strength && strength.score < s.minStrength;
    rules.push({
      key: "strength",
      label: "Hard to guess",
      met,
      hint: failing ? strength.warning || strength.suggestions[0] || STRENGTH_HINT : STRENGTH_HINT,
    });
  }
  return rules;
}

/** Every rule holds. A rule still being computed (null) doesn't block — Clerk re-checks anyway. */
export function rulesSatisfied(rules: Rule[]): boolean {
  return rules.every((r) => r.met !== false);
}
