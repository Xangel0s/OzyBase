import { useAgentNexus } from './useAgentNexus';

export const useEngramNexus = () => {
  const nexus = useAgentNexus('engram');
  return {
    engramFeed: nexus.engramFeed,
    engramStatus: nexus.engramStatus,
    engramTotalEvents: nexus.engramTotalEvents,
    engramWindowHours: nexus.engramWindowHours,
    engramChronicle: nexus.engramChronicle,
    engramEntropy: nexus.engramEntropy,
    engramKernelConfig: nexus.engramKernelConfig,
    engramAutonomyConfig: nexus.engramAutonomyConfig,
    engramConfigLoading: nexus.engramConfigLoading,
    engramConfigSaving: nexus.engramConfigSaving,
    engramAutonomyLoading: nexus.engramAutonomyLoading,
    engramAutonomySaving: nexus.engramAutonomySaving,
    engramCompactionRunning: nexus.engramCompactionRunning,
    engramDiagnosticRunning: nexus.engramDiagnosticRunning,
    engramDiagnostic: nexus.engramDiagnostic,
    leadArchitectAudit: nexus.leadArchitectAudit,
    loadEngramKernelConfig: nexus.loadEngramKernelConfig,
    saveEngramKernelConfig: nexus.saveEngramKernelConfig,
    saveEngramAutonomyLevel: nexus.saveEngramAutonomyLevel,
    runEngramDiagnostic: nexus.runEngramDiagnostic,
    refreshEngramContext: nexus.refreshEngramContext,
    compactEngramNow: nexus.compactEngramNow,
  };
};

