import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ICheckState,
  IFlowConfig,
  IVerificationCheck,
  TFlowPhase,
} from './types';
import {
  CHECKS_FAST,
  CHECKS_STANDARD,
  FLOW_CONFIG_DEFAULTS,
} from './types';

const TRANSITION_DURATION_MS = 800;
const SUCCESS_HOLD_MS = 1500;

function getCheckState(
  elapsed: number,
  checks: IVerificationCheck[],
): ICheckState {
  const totalDuration = checks.reduce((sum, c) => sum + c.duration, 0);
  let acc = 0;
  for (let i = 0; i < checks.length; i++) {
    const check = checks[i];
    if (!check) continue;
    acc += check.duration;
    if (elapsed < acc) {
      return { currentIndex: i, overallProgress: elapsed / totalDuration, isComplete: false };
    }
  }
  return { currentIndex: checks.length, overallProgress: 1, isComplete: true };
}

export interface IFlowController {
  phase: TFlowPhase;
  checkState: ICheckState;
  currentCheck: IVerificationCheck | null;
  checks: IVerificationCheck[];
  /** Timestamp that fires when a check completes (use to trigger swarm pulse) */
  pulseTimestamp: number;
  /** Trigger the submit from review → swarm */
  submit: () => void;
  /** Skip to a specific phase (for tuning) */
  jumpTo: (phase: TFlowPhase) => void;
  /** Reset back to initial state */
  reset: () => void;
  config: IFlowConfig;
}

export function useFlowController(
  configOverrides?: Partial<IFlowConfig>,
): IFlowController {
  const config: IFlowConfig = { ...FLOW_CONFIG_DEFAULTS, ...configOverrides };
  const checks = config.speed === 'fast' ? CHECKS_FAST : CHECKS_STANDARD;

  const initialPhase: TFlowPhase = config.skipReview ? 'swarm' : 'review';
  const [phase, setPhase] = useState<TFlowPhase>(initialPhase);
  const [elapsed, setElapsed] = useState(0);
  const [pulseTimestamp, setPulseTimestamp] = useState(0);

  const startTime = useRef(0);
  const lastCheckIndex = useRef(-1);
  const transitionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Start the swarm timer when we enter swarm phase
  useEffect(() => {
    if (phase !== 'swarm') return;
    startTime.current = performance.now();
    setElapsed(0);
    lastCheckIndex.current = -1;

    const interval = setInterval(() => {
      setElapsed(performance.now() - startTime.current);
    }, 50);
    return () => clearInterval(interval);
  }, [phase]);

  const checkState = getCheckState(elapsed, checks);

  // Fire pulse when a check completes
  useEffect(() => {
    if (phase !== 'swarm') return;
    if (checkState.currentIndex !== lastCheckIndex.current) {
      if (checkState.currentIndex > 0 && lastCheckIndex.current >= 0) {
        setPulseTimestamp(performance.now());
      }
      lastCheckIndex.current = checkState.currentIndex;
    }
  }, [checkState.currentIndex, phase]);

  // Transition to complete when all checks done
  useEffect(() => {
    if (phase !== 'swarm' || !checkState.isComplete) return;
    successTimeout.current = setTimeout(() => {
      setPhase('complete');
    }, SUCCESS_HOLD_MS);
    return () => {
      if (successTimeout.current) {
        clearTimeout(successTimeout.current);
        successTimeout.current = null;
      }
    };
  }, [checkState.isComplete, phase]);

  // Cleanup timeouts
  useEffect(() => {
    return () => {
      if (transitionTimeout.current) clearTimeout(transitionTimeout.current);
      if (successTimeout.current) clearTimeout(successTimeout.current);
    };
  }, []);

  const submit = useCallback(() => {
    setPhase('transition');
    transitionTimeout.current = setTimeout(() => {
      setPhase('swarm');
    }, TRANSITION_DURATION_MS);
  }, []);

  const jumpTo = useCallback((target: TFlowPhase) => {
    setPhase(target);
    if (target === 'swarm') {
      setElapsed(0);
      lastCheckIndex.current = -1;
    }
  }, []);

  const reset = useCallback(() => {
    setPhase(initialPhase);
    setElapsed(0);
    lastCheckIndex.current = -1;
  }, [initialPhase]);

  const currentCheck = checks[checkState.currentIndex] ?? null;

  return {
    phase,
    checkState,
    currentCheck,
    checks,
    pulseTimestamp,
    submit,
    jumpTo,
    reset,
    config,
  };
}
