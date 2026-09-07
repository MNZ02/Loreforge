# Two-Agent S1 Field Exercise Scenario

This directory contains the executable scenario and setup script for the S1 real two-provider exercise between Gemini (Flash) in Antigravity and Muse Spark 1.3 in Muse.

## Step 1: Initialize Disposable Test Fixture

Run the setup script with a fresh, empty temporary directory.
The script initializes a disposable Git repo, registers the project and agents, and creates Task A (root) and Task B (dependent on A).

```bash
node examples/two-agent/setup.mjs /tmp/agent-company-s1
```

This creates `/tmp/agent-company-s1/ids.json` with concrete UUIDs for `projectId`, `taskAId`, `taskBId`, along with `homeDir`, `repoDir`, `packageRoot`, and `cliBin`.

### Command Execution from Fixture Checkout

When editing or running tests inside the fixture checkout (`/tmp/agent-company-s1/repo`), running bare `npm run lore` will fail because `npm` looks for `package.json` in the current working directory. Always invoke the CLI using either:
- The absolute built entry: `node /Users/mnz/dev/loreforge/dist/cli/main.js <namespace> <verb> ...`
- Or the explicit package prefix: `npm run --prefix /Users/mnz/dev/loreforge lore -- <namespace> <verb> ...`

The examples below use the absolute built CLI entry `node /Users/mnz/dev/loreforge/dist/cli/main.js`, which executes consistently from any working directory.

---

## Step 2: Muse Session Actions (Task A)

In the real Muse session (using `--home /tmp/agent-company-s1/home`):

1. **Retrieve Task A Context**:
   ```bash
   node /Users/mnz/dev/loreforge/dist/cli/main.js context --home /tmp/agent-company-s1/home --input - <<'EOF'
   {"schemaVersion":1,"projectId":"<PROJECT_ID>","payload":{"taskId":"<TASK_A_ID>","mode":"work"}}
   EOF
   ```

2. **Claim Task A**:
   ```bash
   node /Users/mnz/dev/loreforge/dist/cli/main.js task claim --home /tmp/agent-company-s1/home --input - <<'EOF'
   {"schemaVersion":1,"projectId":"<PROJECT_ID>","actorId":"muse","requestId":"muse-claim-a-1","payload":{"taskId":"<TASK_A_ID>"}}
   EOF
   ```
   Save the returned `claimToken` privately.

3. **Implement Feature & Test in Fixture Repo** (`/tmp/agent-company-s1/repo`):
   - Add `export function add(a, b) { return a + b; }` to `math.js`.
   - Update `math.test.js` to import `add` along with `subtract` and add the test assertion:
     ```javascript
     import { subtract, add } from "./math.js";
     if (subtract(5, 2) !== 3) throw new Error("test failed");
     if (add(2, 3) !== 5) throw new Error("add failed");
     console.log("math tests pass");
     ```
   - Run `node math.test.js` in `/tmp/agent-company-s1/repo`.
   - Commit changes in the fixture repo:
     ```bash
     cd /tmp/agent-company-s1/repo && git add math.js math.test.js && git commit -m "Implement add function"
     ```

4. **Submit Completed Handoff**:
   Observe current HEAD commit hash via `git rev-parse HEAD`:
   ```bash
   node /Users/mnz/dev/loreforge/dist/cli/main.js handoff --home /tmp/agent-company-s1/home --input - <<'EOF'
   {
     "schemaVersion": 1,
     "projectId": "<PROJECT_ID>",
     "actorId": "muse",
     "requestId": "muse-handoff-a-1",
     "payload": {
       "taskId": "<TASK_A_ID>",
       "claimToken": "<CLAIM_TOKEN_A>",
       "outcome": "completed",
       "summary": "Implemented add(a, b) in math.js and verified with math.test.js.",
       "evidence": {
         "checkoutRoot": "/tmp/agent-company-s1/repo",
         "head": "<COMMIT_HASH>",
         "dirty": false,
         "files": [
           { "path": "math.js", "change": "modified" },
           { "path": "math.test.js", "change": "modified" }
         ],
         "checks": [
           { "command": "node math.test.js", "outcome": "passed", "summary": "All tests passed" }
         ]
       },
       "unresolved": [],
       "nextSteps": ["Task B can now be implemented using add(a, b)"],
       "blockingQuestionIds": []
     }
   }
   EOF
   ```

---

## Step 3: Flash Session Actions (Task B & Clarification)

In the real Flash session (using `--home /tmp/agent-company-s1/home`):

1. **Retrieve Task B Context**:
   Context snapshot automatically includes Task A's completed status, evidence, and git commit.
   ```bash
   node /Users/mnz/dev/loreforge/dist/cli/main.js context --home /tmp/agent-company-s1/home --input - <<'EOF'
   {"schemaVersion":1,"projectId":"<PROJECT_ID>","payload":{"taskId":"<TASK_B_ID>","mode":"work"}}
   EOF
   ```

2. **Claim Task B**:
   ```bash
   node /Users/mnz/dev/loreforge/dist/cli/main.js task claim --home /tmp/agent-company-s1/home --input - <<'EOF'
   {"schemaVersion":1,"projectId":"<PROJECT_ID>","actorId":"flash","requestId":"flash-claim-b-1","payload":{"taskId":"<TASK_B_ID>"}}
   EOF
   ```
   Save the returned `claimToken` privately.

3. **Ask Muse a Clarification Question**:
   ```bash
   node /Users/mnz/dev/loreforge/dist/cli/main.js ask --home /tmp/agent-company-s1/home --input - <<'EOF'
   {
     "schemaVersion": 1,
     "projectId": "<PROJECT_ID>",
     "actorId": "flash",
     "requestId": "flash-ask-b-1",
     "payload": {
       "taskId": "<TASK_B_ID>",
       "toAgentId": "muse",
       "body": "Should multiply handle negative multiplier using repeated subtraction or direct multiplication?"
     }
   }
   EOF
   ```
   Save the returned question ID (`<QUESTION_ID>`).

4. **Submit Blocked Handoff**:
   ```bash
   node /Users/mnz/dev/loreforge/dist/cli/main.js handoff --home /tmp/agent-company-s1/home --input - <<'EOF'
   {
     "schemaVersion": 1,
     "projectId": "<PROJECT_ID>",
     "actorId": "flash",
     "requestId": "flash-handoff-b-blocked",
     "payload": {
       "taskId": "<TASK_B_ID>",
       "claimToken": "<CLAIM_TOKEN_B>",
       "outcome": "blocked",
       "summary": "Blocked pending clarification on negative multiplier handling in multiply().",
       "evidence": {
         "checkoutRoot": "/tmp/agent-company-s1/repo",
         "head": "<COMMIT_HASH>",
         "dirty": false,
         "files": [],
         "checks": []
       },
       "unresolved": ["Clarification requested from Muse"],
       "nextSteps": ["Await answer, reopen Task B, and complete implementation"],
       "blockingQuestionIds": ["<QUESTION_ID>"]
     }
   }
   EOF
   ```

---

## Step 4: Muse Answers & Flash Resumes

1. **Muse checks inbox and answers**:
   ```bash
   node /Users/mnz/dev/loreforge/dist/cli/main.js inbox --home /tmp/agent-company-s1/home --input - <<'EOF'
   {"schemaVersion":1,"projectId":"<PROJECT_ID>","actorId":"muse","payload":{"after":0,"limit":20}}
   EOF

   node /Users/mnz/dev/loreforge/dist/cli/main.js question answer --home /tmp/agent-company-s1/home --input - <<'EOF'
   {
     "schemaVersion": 1,
     "projectId": "<PROJECT_ID>",
     "actorId": "muse",
     "requestId": "muse-ans-1",
     "payload": {
       "questionId": "<QUESTION_ID>",
       "body": "Use standard JavaScript multiplication a * b directly for clarity."
     }
   }
   EOF
   ```

2. **Flash checks inbox, reopens, and reclaims**:
   ```bash
   # Check inbox
   node /Users/mnz/dev/loreforge/dist/cli/main.js inbox --home /tmp/agent-company-s1/home --input - <<'EOF'
   {"schemaVersion":1,"projectId":"<PROJECT_ID>","actorId":"flash","payload":{"after":0,"limit":20}}
   EOF

   # Reopen task B
   node /Users/mnz/dev/loreforge/dist/cli/main.js task reopen --home /tmp/agent-company-s1/home --input - <<'EOF'
   {"schemaVersion":1,"projectId":"<PROJECT_ID>","actorId":"flash","requestId":"flash-reopen-b-1","payload":{"taskId":"<TASK_B_ID>"}}
   EOF

   # Reclaim task B (attempt 2)
   node /Users/mnz/dev/loreforge/dist/cli/main.js task claim --home /tmp/agent-company-s1/home --input - <<'EOF'
   {"schemaVersion":1,"projectId":"<PROJECT_ID>","actorId":"flash","requestId":"flash-claim-b-2","payload":{"taskId":"<TASK_B_ID>"}}
   EOF
   ```

3. **Implement Multiply Feature & Test in Fixture Repo** (`/tmp/agent-company-s1/repo`):
   - Add `export function multiply(a, b) { return a * b; }` to `math.js`.
   - Update `math.test.js` to import `multiply` along with `subtract` and `add`:
     ```javascript
     import { subtract, add, multiply } from "./math.js";
     if (subtract(5, 2) !== 3) throw new Error("test failed");
     if (add(2, 3) !== 5) throw new Error("add failed");
     if (multiply(3, 4) !== 12) throw new Error("multiply failed");
     console.log("math tests pass");
     ```
   - Run `node math.test.js` in `/tmp/agent-company-s1/repo`.
   - Commit changes in the fixture repo:
     ```bash
     cd /tmp/agent-company-s1/repo && git add math.js math.test.js && git commit -m "Implement multiply function"
     ```

4. **Submit Completed Handoff for Task B**:
   Observe current HEAD commit hash via `git rev-parse HEAD`:
   ```bash
   node /Users/mnz/dev/loreforge/dist/cli/main.js handoff --home /tmp/agent-company-s1/home --input - <<'EOF'
   {
     "schemaVersion": 1,
     "projectId": "<PROJECT_ID>",
     "actorId": "flash",
     "requestId": "flash-handoff-b-completed",
     "payload": {
       "taskId": "<TASK_B_ID>",
       "claimToken": "<CLAIM_TOKEN_B2>",
       "outcome": "completed",
       "summary": "Implemented multiply(a, b) in math.js using standard multiplication and verified with math.test.js.",
       "evidence": {
         "checkoutRoot": "/tmp/agent-company-s1/repo",
         "head": "<COMMIT_HASH>",
         "dirty": false,
         "files": [
           { "path": "math.js", "change": "modified" },
           { "path": "math.test.js", "change": "modified" }
         ],
         "checks": [
           { "command": "node math.test.js", "outcome": "passed", "summary": "All tests passed" }
         ]
       },
       "unresolved": [],
       "nextSteps": ["Two-agent arithmetic features complete"],
       "blockingQuestionIds": []
     }
   }
   EOF
   ```

---

## Step 5: Fresh Session Verification

Start a third, fresh session with only the `projectId`, `taskBId`, and `home` directory.
Verify that it can retrieve full context, understand that Task A and Task B are completed, and inspect all decisions and question/answer records without having access to prior session memory:

```bash
node /Users/mnz/dev/loreforge/dist/cli/main.js context --home /tmp/agent-company-s1/home --input - <<'EOF'
{"schemaVersion":1,"projectId":"<PROJECT_ID>","payload":{"taskId":"<TASK_B_ID>","mode":"work"}}
EOF
```
