// Synthetic routing responses for the older isolated group regressions.
// New participation tests construct independent schemas and adversarial cases.
export function groupParticipationFixture(allowedSpeakerIds,overrides={}) {
  return {audience:'selected',intent:'conversation',closedConversation:false,semanticTargetIds:[],requiredReplyIds:[],
    allowedSpeakerIds:[...allowedSpeakerIds],operationalSpeakerIds:[],...overrides};
}
