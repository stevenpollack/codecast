import { OpenCallButton } from "./OpenCallButton";
import { CallCardAgentReply } from "./AgentReplyPeek";
import { CallCardRecordButton, CallCardRecordingMark } from "./RoomRecording";

/** What a call's card carries beside its mic and End, in this order: the
 *  recording mark (the Stop while the room records), Record, and the door to
 *  the stage. One list for every place that draws the card in the page (the
 *  header's face row and the phone's strip under it), so a control added to
 *  the card reaches both. The desktop float draws its own: a window sized to
 *  its card, where the first press's question would be cut off. An agent's
 *  answer hangs from the card while the stage is closed. */
export function CallCardAccessories() {
  return (
    <>
      <CallCardRecordingMark />
      <CallCardRecordButton />
      <OpenCallButton />
      <CallCardAgentReply />
    </>
  );
}
