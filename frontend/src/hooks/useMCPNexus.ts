import { useAgentNexus } from './useAgentNexus';

export const useMCPNexus = () => {
  const nexus = useAgentNexus('mcp');
  return {
    agents: nexus.agents,
    approvalsLoading: nexus.approvalsLoading,
    bridgeStatus: nexus.bridgeStatus,
    isBridgeConnected: nexus.isBridgeConnected,
    rawMCPFrames: nexus.rawMCPFrames,
    refreshBridge: nexus.refreshBridge,
    pipelineState: nexus.pipelineState,
    semanticHealth: nexus.semanticHealth,
    notice: nexus.notice,
    clearNotice: nexus.clearNotice,
    skillCatalog: nexus.skillCatalog,
    skillsLoading: nexus.skillsLoading,
    engramCompactionRunning: nexus.engramCompactionRunning,
    skillUpdatePending: nexus.skillUpdatePending,
    agentLevelUpdating: nexus.agentLevelUpdating,
    pendingApprovals: nexus.pendingApprovals,
    approvalActioningByID: nexus.approvalActioningByID,
    updateSkillPolicy: nexus.updateSkillPolicy,
    updateAgentAccessLevel: nexus.updateAgentAccessLevel,
    resolvePendingApproval: nexus.resolvePendingApproval,
    compactEngramNow: nexus.compactEngramNow,
  };
};

