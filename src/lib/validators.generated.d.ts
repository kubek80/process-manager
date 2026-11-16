import type { ErrorObject } from "ajv";

/** A check generated from one of the schemas. After a call that returns false, `errors` says why. */
export interface Validator {
  (data: unknown): boolean;
  errors?: ErrorObject[] | null;
}
export const validateProcessDoc: Validator;
export const validateStandardDoc: Validator;
export const validateCatalogDoc: Validator;
