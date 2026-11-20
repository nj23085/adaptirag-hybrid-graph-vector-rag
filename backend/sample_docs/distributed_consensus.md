# Distributed Systems and Consensus in Modern Cloud Architecture

## Abstract
Distributed consensus is the fundamental protocol by which a set of independent processes agree on a state machine transition or value, despite message delays, network partitions, and machine crashes.

## 1. The Core Consensus Dilemma
In asynchronous networks without synchronized clocks, the FLP Impossibility Theorem (Fischer, Lynch, Paterson, 1985) establishes that no deterministic consensus protocol can guarantee both safety and liveness in the presence of even a single unannounced fail-stop failure.

Practical systems resolve this trade-off by favoring safety over liveness during network instability. Under partial synchrony models, algorithms guarantee that safety invariants are never violated, while liveness is eventually recovered once message delivery bounds stabilize.

## 2. The Paxos Protocol
Developed by Leslie Lamport, Paxos operates in distinct phases:
- **Phase 1a (Prepare):** A Proposer selects a unique proposal number $n$ and sends a Prepare request to a majority quorum of Acceptors.
- **Phase 1b (Promise):** Acceptors promise not to accept proposals numbered lower than $n$, returning the highest-numbered proposal they have accepted so far.
- **Phase 2a (Accept):** If a quorum promises, the Proposer chooses the value associated with the highest proposal number returned, or its own proposed value if none exists, and issues an Accept request.
- **Phase 2b (Accepted):** Acceptors register the proposal unless a higher proposal number was promised in the interim.

## 3. Raft Consensus Algorithm
Designed by Ongaro and Ousterhout at Stanford University, Raft divides consensus into three modular subproblems:
1. **Leader Election:** Heartbeats and election timeouts ensure a single leader coordinates log replication.
2. **Log Replication:** AppendEntries RPCs enforce monotonic index matching across follower nodes.
3. **Safety Invariants:** The Election Restriction rule mandates that candidate nodes cannot win an election unless their log is at least as up-to-date as any majority quorum member.

## 4. Byzantine Fault Tolerance (BFT)
In adversarial environments, nodes may fail arbitrarily (malicious collusion, bit-flips, Byzantine behavior). Practical Byzantine Fault Tolerance (PBFT) requires $3f + 1$ total nodes to tolerate $f$ Byzantine failures, requiring Pre-prepare, Prepare, and Commit message phases with cryptographic signatures.
