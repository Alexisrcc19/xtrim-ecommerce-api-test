import { HttpError } from "../../middlewares/errors.js";

export const statuses = ["NEW", "IN_PROGRESS", "CLOSED"] as const;
export type LeadStatus = typeof statuses[number];
export interface LeadInput { full_name: string; phone: string; province: string; plan_id: string }
export interface StatusInput { status: LeadStatus; outcome: "WON" | "LOST" | null; sale_amount: string | null }
export interface LeadFilters { page: number; limit: number; search?: string; status?: LeadStatus; province?: string }

export const provinces = [
  "Azuay", "Bolívar", "Cañar", "Carchi", "Chimborazo", "Cotopaxi", "El Oro", "Esmeraldas",
  "Galápagos", "Guayas", "Imbabura", "Loja", "Los Ríos", "Manabí", "Morona Santiago", "Napo",
  "Orellana", "Pastaza", "Pichincha", "Santa Elena", "Santo Domingo de los Tsáchilas", "Sucumbíos", "Tungurahua", "Zamora Chinchipe",
] as const;
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function invalid(message: string): never { throw new HttpError(400, "VALIDATION_ERROR", message); }

export function objectBody(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Se requiere un objeto JSON");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !allowed.includes(key))) invalid("Campos no permitidos");
  return body;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}]/u.test(value)) invalid(`${field} inválido`);
  const result = value.trim().replace(/\s+/g, " ");
  if (!result || result.length > max) invalid(`${field} inválido`);
  return result;
}

export function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) invalid("UUID inválido");
  return value;
}

function province(value: unknown): string {
  const input = text(value, "province", 100);
  const result = provinces.find(name => fold(name) === fold(input));
  if (!result) invalid("Provincia ecuatoriana inválida");
  return result;
}

function status(value: unknown): LeadStatus {
  if (!statuses.includes(value as LeadStatus)) invalid("Estado inválido");
  return value as LeadStatus;
}

export function leadInput(value: unknown, partial = false): Partial<LeadInput> {
  const body = objectBody(value, ["full_name", "phone", "province", "plan_id"]);
  if (partial && !Object.keys(body).length) invalid("Debe enviar al menos un campo");
  const result: Partial<LeadInput> = {};
  if (!partial || "full_name" in body) {
    const name = text(body.full_name, "full_name", 150);
    if (name.length < 2 || !/^[\p{L}\p{M} .’'−-]+$/u.test(name) || !/\p{L}/u.test(name)) invalid("Nombre inválido");
    result.full_name = name;
  }
  if (!partial || "phone" in body) {
    const phone = text(body.phone, "phone", 30).replace(/[ ()-]/g, "");
    if (!/^(0[2-7][0-9]{7}|09[0-9]{8}|\+593[2-7][0-9]{7}|\+5939[0-9]{8})$/.test(phone)) invalid("Teléfono ecuatoriano inválido");
    result.phone = phone;
  }
  if (!partial || "province" in body) result.province = province(body.province);
  if (!partial || "plan_id" in body) result.plan_id = uuid(body.plan_id);
  return result;
}

export function createLeadInput(value: unknown): LeadInput {
  return leadInput(value) as LeadInput;
}

export function statusInput(value: unknown): StatusInput {
  const body = objectBody(value, ["status", "outcome", "sale_amount"]);
  const nextStatus = status(body.status);
  if (nextStatus !== "CLOSED") {
    if (body.outcome != null || body.sale_amount != null) invalid("Un lead abierto no admite resultado ni monto");
    return { status: nextStatus, outcome: null, sale_amount: null };
  }
  if (body.outcome !== "WON" && body.outcome !== "LOST") invalid("El cierre requiere WON o LOST");
  if (body.outcome === "LOST") {
    if (body.sale_amount != null) invalid("Un cierre perdido no admite monto");
    return { status: nextStatus, outcome: "LOST", sale_amount: null };
  }
  if (typeof body.sale_amount !== "string" || !/^(0|[1-9][0-9]{0,7})(\.[0-9]{1,2})?$/.test(body.sale_amount)) {
    invalid("sale_amount debe ser un decimal no negativo de hasta 8 enteros y 2 decimales, como cadena");
  }
  return { status: nextStatus, outcome: "WON", sale_amount: body.sale_amount };
}

export function leadFilters(query: unknown): LeadFilters {
  const body = objectBody(query, ["page", "limit", "search", "status", "province"]);
  const integer = (value: unknown, fallback: number, max: number): number => {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value) || Number(value) > max) invalid("Paginación inválida");
    return Number(value);
  };
  return {
    page: integer(body.page, 1, 1000000), limit: integer(body.limit, 20, 100),
    ...(body.search !== undefined ? { search: text(body.search, "search", 100) } : {}),
    ...(body.status !== undefined ? { status: status(body.status) } : {}),
    ...(body.province !== undefined ? { province: province(body.province) } : {}),
  };
}
