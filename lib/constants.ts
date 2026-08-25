export const LEGAL_AREAS = [
  "Защита прав потребителей",
  "Гражданское право",
  "Договорное право",
  "Предпринимательское право",
  "Налоговое право",
  "Трудовое право",
  "Персональные данные",
  "Цифровое право",
  "Другое",
] as const;

export const USER_TYPES = [
  { value: "individual", label: "Физическое лицо" },
  { value: "ip", label: "ИП" },
  { value: "too", label: "ТОО" },
] as const;

export const USER_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  USER_TYPES.map((type) => [type.value, type.label]),
);

export const MIN_DESCRIPTION_LENGTH = 20;
