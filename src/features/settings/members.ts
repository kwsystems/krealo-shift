import { z } from 'zod';

import { callFunction } from '@/lib/firebase/functions';
import { docId } from '@/lib/firebase/ids';
import { AdminError, toAdminError } from '@/hooks/use-admin-query';

/**
 * Quién tiene acceso a la organización (§7).
 *
 * TODO PASA POR CLOUD FUNCTION, y no por comodidad: el correo de una persona no vive
 * en Firestore sino en Firebase Auth, que el cliente no puede consultar. Además, un
 * cambio de rol tiene que quedar en `audit_logs` y no dejar la organización sin nadie
 * que la administre, y eso son comprobaciones que el cliente no puede hacerse a sí
 * mismo de forma fiable.
 *
 * La colección de membresías está cerrada a escritura en las reglas justamente por
 * esto: si el panel pudiera escribirla, cualquiera con la consola del navegador
 * abierta se subiría el rol.
 */

export const appRoles = ['owner', 'admin', 'manager', 'employee'] as const;
export type AppRoleName = (typeof appRoles)[number];

const memberSchema = z.object({
  userId: docId(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  role: z.enum(appRoles),
  status: z.enum(['invited', 'active', 'suspended']),
  isSelf: z.boolean(),
  /** La ficha de empleado de esa cuenta, si la tiene. Ver `listMembers`. */
  employeeId: docId().nullable().default(null),
  managedLocationIds: z.array(z.string()).default([]),
});

const invitationSchema = z.object({
  email: z.string(),
  role: z.enum(appRoles),
  createdAt: z.string(),
  locationIds: z.array(z.string()).default([]),
});

const listSchema = z.object({
  members: z.array(memberSchema),
  invitations: z.array(invitationSchema),
});

export type Member = z.infer<typeof memberSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type MemberList = z.infer<typeof listSchema>;

async function llamar<T>(nombre: string, payload: unknown, esquema: z.ZodType<T>): Promise<T> {
  const { data, error } = await callFunction<unknown>(nombre, payload);
  if (error !== null) throw toAdminError(error);
  const parsed = esquema.safeParse(data);
  if (!parsed.success) throw new AdminError('unexpectedShape', parsed.error.message);
  return parsed.data;
}

export function fetchMembers(organizationId: string): Promise<MemberList> {
  return llamar('listMembers', { organizationId }, listSchema);
}

const okSchema = z.object({ ok: z.boolean() }).or(z.object({ invitationId: z.string() }));

export function inviteMember(params: {
  organizationId: string;
  email: string;
  role: AppRoleName;
  /** Las sedes de un gerente: sin ellas no puede hacer nada (4-oct). */
  locationIds?: string[];
}): Promise<unknown> {
  return llamar('inviteMember', params, okSchema);
}

export function setMemberRole(params: {
  organizationId: string;
  userId: string;
  role: AppRoleName;
  locationIds?: string[];
}): Promise<unknown> {
  return llamar('setMemberRole', params, okSchema);
}

/** Las sedes que gestiona un gerente (4-oct). Ver `functions/src/members.ts`. */
export function setMemberLocations(params: {
  organizationId: string;
  userId: string;
  locationIds: string[];
}): Promise<unknown> {
  return llamar('setMemberLocations', params, okSchema);
}

export function revokeMember(params: { organizationId: string; userId: string }): Promise<unknown> {
  return llamar('revokeMember', params, okSchema);
}

/** Devolver el acceso a quien se le quitó (5-oct). Ver `reactivateMember`. */
export function reactivateMember(params: {
  organizationId: string;
  userId: string;
}): Promise<unknown> {
  return llamar('reactivateMember', params, okSchema);
}

/** Separar una cuenta de su ficha de empleado (5-oct). Ver `unlinkMemberEmployee`. */
export function unlinkMemberEmployee(params: {
  organizationId: string;
  userId: string;
}): Promise<unknown> {
  return llamar('unlinkMemberEmployee', params, okSchema);
}

export function cancelInvitation(params: {
  organizationId: string;
  email: string;
}): Promise<unknown> {
  return llamar('cancelInvitation', params, okSchema);
}
