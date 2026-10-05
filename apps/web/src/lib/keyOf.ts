/** Turns a dotted identifier ("auth.login") into its translation key segment ("auth_login"). */
export const keyOf = (value: string): string => value.replace(/\./g, "_");
