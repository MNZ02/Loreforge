// Private test seam for transaction-recovery tests (A08). The injector runs
// at named write boundaries inside the handoff transaction and throws to
// simulate a crash between writes. Set only from tests; never wired to an
// environment variable, CLI flag, or normal operation.

export type FaultInjector = (boundary: string) => void;

let injector: FaultInjector | null = null;

export function setFaultInjector(next: FaultInjector | null): void {
  injector = next;
}

export function faultBoundary(boundary: string): void {
  injector?.(boundary);
}
