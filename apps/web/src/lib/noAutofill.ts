/**
 * Props for fields that are NOT login fields (project paths, URLs, API tokens). Browsers and password
 * managers treat any form with a password-type field as a login form and fill the saved email and
 * password into it; "off" alone is ignored, so this uses the values they do respect.
 */
export const noAutofill = {
  autoComplete: 'off',
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const

/** For secret fields (tokens, auth headers): "new-password" stops saved passwords from being filled in. */
export const noAutofillSecret = { ...noAutofill, autoComplete: 'new-password' } as const
