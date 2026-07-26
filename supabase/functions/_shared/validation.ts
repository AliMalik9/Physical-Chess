const namePattern = /[^\p{L}\p{N} .,'-]/gu;

export function displayName(value: unknown, fallback: string): string {
  const name = String(value ?? fallback).replace(namePattern, "").trim().replace(/\s+/g, " ").slice(0, 24);
  if (!name) throw new Error("INVALID_INPUT");
  return name;
}

export function uuid(value: unknown): string {
  const text = String(value ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(text)) throw new Error("INVALID_INPUT");
  return text;
}

export function square(value: unknown): string {
  const text = String(value ?? "");
  if (!/^[a-h][1-8]$/.test(text)) throw new Error("INVALID_INPUT");
  return text;
}

export function actionId(value: unknown): string { return uuid(value); }
