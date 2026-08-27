import { useRouter } from 'expo-router';

import { ScheduleScreen } from '@/features/schedules/schedule-screen';

/** Pestaña Horario (§6.3, §11.3): la función principal del panel administrativo. */
export default function ManagerScheduleRoute() {
  const router = useRouter();
  return <ScheduleScreen onGoToTeam={() => router.push('/(manager)/team')} />;
}
