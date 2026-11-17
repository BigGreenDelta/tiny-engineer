import { useLocation } from "wouter-preact";
import type { Settings } from "../api/types";
import { useRobot } from "../robot";
import type { Range } from "../servos";
import { GuidedCalibration } from "../setup/GuidedCalibration";
import { PlaceParts } from "../setup/PlaceParts";
import { ServosHub } from "../setup/ServosHub";
import { useCalibration } from "../setup/useCalibration";
import { useStatus } from "../status/status";

/** The setup wizard's servo step, reachable after setup without a factory reset. */
function CalibrationFlow({ settings }: { settings: Settings }) {
  const { applySettings } = useRobot();
  const { perform } = useStatus();
  const [, navigate] = useLocation();
  const calibration = useCalibration(settings);

  async function saveRanges(ranges: Range[] = calibration.ranges) {
    const result = await perform<Settings>({
      path: "/settings",
      request: {
        method: "POST",
        json: {
          servo_mins: ranges.map(([min]) => min),
          servo_maxs: ranges.map(([, max]) => max),
        },
      },
      pending: "Saving servo ranges…",
      done: "Servo ranges saved.",
      failure: "Save failed",
      onSuccess: applySettings,
    });

    if (result?.ok === true) {
      calibration.goHub();
    }
  }

  return (
    <>
      {calibration.mode === "hub" && (
        <ServosHub
          calibration={calibration}
          onSkip={() => navigate("/")}
          skipTitle="Done"
          skipHint="Back to the main screen; saved limits stay as they are"
        />
      )}
      {calibration.mode === "assembly" && <PlaceParts calibration={calibration} />}
      {calibration.mode === "guided" && (
        <GuidedCalibration
          calibration={calibration}
          onComplete={(ranges) => void saveRanges(ranges)}
        />
      )}
    </>
  );
}

export function Calibration() {
  const { settings } = useRobot();

  return (
    <section>
      <h2 className="page-title">Servo calibration</h2>
      <p className="page-desc">
        Set each joint’s safe limits. Animations pause while a servo is being moved.
      </p>
      {settings ? <CalibrationFlow settings={settings} /> : <p>Loading settings…</p>}
    </section>
  );
}
