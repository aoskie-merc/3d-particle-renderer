/**
 * Flow phases for the connected prototype:
 *
 * 1. review        → MQ "Review Application" screen overlay
 * 2. transition    → fade out review, ramp up swarm energy
 * 3. swarm         → verification checks play while murmuration animates
 * 4. complete      → "Congrats, you're in!" with set-up-account CTA
 * 5. dashboard     → Post-onboarding focused-funding dashboard
 *
 * In sculpture-tuning mode (current), we skip review and start at 'swarm'.
 */
export type TFlowPhase =
  | 'review'
  | 'transition'
  | 'swarm'
  | 'complete'
  | 'dashboard';

export interface IVerificationCheck {
  label: string;
  duration: number;
}

export interface ICheckState {
  currentIndex: number;
  overallProgress: number;
  isComplete: boolean;
}

export interface IFlowConfig {
  /** Skip review and start directly at swarm (for animation tuning) */
  skipReview: boolean;
  /** Speed preset: 'standard' for real timing, 'fast' for demo */
  speed: 'standard' | 'fast';
  /** Whether to show the post-onboarding dashboard after completion */
  showDashboard: boolean;
}

export const FLOW_CONFIG_DEFAULTS: IFlowConfig = {
  skipReview: true,
  speed: 'standard',
  showDashboard: false,
};

export const CHECKS_STANDARD: IVerificationCheck[] = [
  { label: 'Verifying business information', duration: 4000 },
  { label: 'Checking regulatory compliance', duration: 4000 },
  { label: 'Reviewing financial history', duration: 5000 },
  { label: 'Assessing risk profile', duration: 4000 },
  { label: 'Confirming identity verification', duration: 4000 },
  { label: 'Evaluating account eligibility', duration: 4000 },
  { label: 'Finalizing review', duration: 3000 },
];

export const CHECKS_FAST: IVerificationCheck[] = [
  { label: 'Verifying business information', duration: 450 },
  { label: 'Checking regulatory compliance', duration: 430 },
  { label: 'Reviewing financial history', duration: 450 },
  { label: 'Assessing risk profile', duration: 420 },
  { label: 'Confirming identity verification', duration: 420 },
  { label: 'Evaluating account eligibility', duration: 420 },
  { label: 'Finalizing review', duration: 410 },
];
