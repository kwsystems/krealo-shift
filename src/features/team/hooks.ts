import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createEmployee,
  fetchEmployeeJobRoles,
  fetchEmployees,
  fetchJobRoles,
  fetchLocationAssignments,
  fetchUpcomingShifts,
  resetEmployeePin,
  setEmployeeStatus,
  updateEmployee,
  type Employee,
  type EmployeeDraft,
  type EmployeeStatus,
} from './api';
import { ADMIN_LIST_STALE_MS } from '@/hooks/use-admin-query';

/**
 * Hooks del equipo (§11.2). Todo el dato remoto vive en TanStack Query: nada de
 * copiarlo a Zustand, que solo guarda preferencias del dispositivo (§4).
 */

export const teamKeys = {
  employees: (organizationId: string) => ['team', 'employees', organizationId] as const,
  assignments: (locationIds: string[]) => ['team', 'assignments', ...locationIds] as const,
  jobRoles: (organizationId: string) => ['team', 'jobRoles', organizationId] as const,
  employeeJobRoles: (organizationId: string) =>
    ['team', 'employeeJobRoles', organizationId] as const,
  upcomingShifts: (employeeId: string) => ['team', 'upcomingShifts', employeeId] as const,
};

export type TeamMember = Employee & {
  locationIds: string[];
  jobRoleIds: string[];
  displayName: string;
};

export function useEmployees(organizationId: string | null) {
  return useQuery({
    queryKey: teamKeys.employees(organizationId ?? 'none'),
    queryFn: () => fetchEmployees(organizationId ?? ''),
    enabled: organizationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

export function useJobRoles(organizationId: string | null) {
  return useQuery({
    queryKey: teamKeys.jobRoles(organizationId ?? 'none'),
    queryFn: () => fetchJobRoles(organizationId ?? ''),
    enabled: organizationId !== null,
    staleTime: 5 * ADMIN_LIST_STALE_MS,
  });
}

/** Equipo completo con ubicaciones y puestos ya combinados por empleado. */
export function useTeam(params: { organizationId: string | null; locationIds: string[] }) {
  const { organizationId, locationIds } = params;

  const employees = useEmployees(organizationId);
  const jobRoles = useJobRoles(organizationId);

  const assignments = useQuery({
    queryKey: teamKeys.assignments(locationIds),
    queryFn: () => fetchLocationAssignments(locationIds),
    enabled: locationIds.length > 0,
    staleTime: ADMIN_LIST_STALE_MS,
  });

  const employeeIds = useMemo(
    () => (employees.data ?? []).map((employee) => employee.id),
    [employees.data],
  );

  const employeeRoles = useQuery({
    queryKey: teamKeys.employeeJobRoles(organizationId ?? 'none'),
    queryFn: () => fetchEmployeeJobRoles(employeeIds),
    enabled: employeeIds.length > 0,
    staleTime: ADMIN_LIST_STALE_MS,
  });

  const members = useMemo<TeamMember[]>(() => {
    const byEmployeeLocations = new Map<string, string[]>();
    for (const assignment of assignments.data ?? []) {
      const current = byEmployeeLocations.get(assignment.employee_id) ?? [];
      current.push(assignment.location_id);
      byEmployeeLocations.set(assignment.employee_id, current);
    }

    const byEmployeeRoles = new Map<string, string[]>();
    for (const row of employeeRoles.data ?? []) {
      const current = byEmployeeRoles.get(row.employee_id) ?? [];
      current.push(row.job_role_id);
      byEmployeeRoles.set(row.employee_id, current);
    }

    return (employees.data ?? []).map((employee) => ({
      ...employee,
      locationIds: byEmployeeLocations.get(employee.id) ?? [],
      jobRoleIds: byEmployeeRoles.get(employee.id) ?? [],
      displayName:
        employee.preferred_name !== null && employee.preferred_name.trim() !== ''
          ? employee.preferred_name
          : employee.full_name,
    }));
  }, [employees.data, assignments.data, employeeRoles.data]);

  return {
    members,
    jobRoles: jobRoles.data ?? [],
    isPending: employees.isPending,
    isFetching: employees.isFetching || assignments.isFetching,
    error: employees.error ?? jobRoles.error ?? assignments.error,
    refetch: () => {
      void employees.refetch();
      void jobRoles.refetch();
      void assignments.refetch();
      void employeeRoles.refetch();
    },
  };
}

/** Nombre visible por id: lo usan horario, horas y solicitudes. */
export function useEmployeeNames(organizationId: string | null): Map<string, string> {
  const employees = useEmployees(organizationId);
  return useMemo(() => {
    const names = new Map<string, string>();
    for (const employee of employees.data ?? []) {
      const preferred =
        employee.preferred_name !== null && employee.preferred_name.trim() !== ''
          ? employee.preferred_name
          : employee.full_name;
      names.set(employee.id, preferred);
    }
    return names;
  }, [employees.data]);
}

export function useTeamMutations(organizationId: string | null) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['team'] });
    void queryClient.invalidateQueries({ queryKey: ['schedule'] });
  };

  const create = useMutation({
    mutationFn: (draft: EmployeeDraft) =>
      createEmployee({ organizationId: organizationId ?? '', draft }),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: (params: { employeeId: string; draft: EmployeeDraft }) => updateEmployee(params),
    onSuccess: invalidate,
  });

  const changeStatus = useMutation({
    mutationFn: (params: { employeeId: string; status: EmployeeStatus }) =>
      setEmployeeStatus(params),
    onSuccess: invalidate,
  });

  const resetPin = useMutation({
    mutationFn: (params: { employeeId: string; pinLength: number }) => resetEmployeePin(params),
  });

  return { create, update, changeStatus, resetPin };
}

export function useUpcomingShifts(employeeId: string | null) {
  return useQuery({
    queryKey: teamKeys.upcomingShifts(employeeId ?? 'none'),
    queryFn: () =>
      fetchUpcomingShifts({ employeeId: employeeId ?? '', fromISO: new Date().toISOString() }),
    enabled: employeeId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}
