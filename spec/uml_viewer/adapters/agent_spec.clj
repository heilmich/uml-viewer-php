(ns uml-viewer.adapters.agent-spec
  (:require [clojure.java.io :as io]
            [speclj.core :refer :all]
            [uml-viewer.adapters.agent :as agent]))

(defn- fake-bin [name]
  (let [dir (io/file (System/getProperty "java.io.tmpdir")
                     (str "uv-agent-" (System/nanoTime)))
        f (io/file dir name)]
    (io/make-parents f)
    (spit f "#!/bin/sh\n")
    (.setExecutable f true)
    f))

(describe "companion agent"
  (it "starts Claude Code by default"
    (let [cfg (agent/config {})]
      (should= :claude (:agent cfg))
      (should= "Claude Code" (:label cfg))
      (should-not (:yolo? cfg))))

  (it "picks a preset by name, ignoring case and blanks"
    (should= :grok (:agent (agent/config {"UML_VIEWER_AGENT" " Grok "})))
    (should= :codex (:agent (agent/config {"UML_VIEWER_AGENT" "codex"})))
    (should= :claude (:agent (agent/config {"UML_VIEWER_AGENT" ""}))))

  (it "rejects an unknown agent"
    (should-throw clojure.lang.ExceptionInfo
                  (agent/config {"UML_VIEWER_AGENT" "eliza"})))

  (it "prefers a custom command over a preset"
    (let [cfg (agent/config {"UML_VIEWER_AGENT" "grok"
                             "UML_VIEWER_AGENT_CMD" "aider --message \"$UML_VIEWER_PROMPT\""})]
      (should= :custom (:agent cfg))
      (should= ["sh" "-c" "aider --message \"$UML_VIEWER_PROMPT\""]
               (agent/launch-args cfg "RULES" "GO"))
      (should= ["-e" "COLORTERM=truecolor"
                "-e" "UML_VIEWER_RULES=RULES"
                "-e" "UML_VIEWER_PROMPT=GO"]
               (agent/session-env cfg "RULES" "GO"))))

  (it "finds the binary from the environment, then install paths, then PATH"
    (let [bin (fake-bin "claude")
          home (-> (fake-bin ".local/bin/claude") .getParentFile .getParentFile .getParentFile)]
      (should= (.getPath bin)
               (:bin (agent/config {"UML_VIEWER_AGENT_BIN" (.getPath bin)})))
      (should= (.getPath bin) (:bin (agent/config {"CLAUDE_BIN" (.getPath bin)})))
      (should= (str home "/.local/bin/claude")
               (:bin (agent/config {"HOME" (str home)})))
      (should= "/no/such/claude"
               (:bin (agent/config {"UML_VIEWER_AGENT_BIN" "/no/such/claude"
                                    "HOME" "/no/such/home"})))
      (should= "grok" (:bin (agent/config {"UML_VIEWER_AGENT" "grok"
                                           "HOME" "/no/such/home"})))))

  (it "lets Claude edit and run the IR tools, but asks before anything else"
    (let [args (agent/launch-args (assoc (agent/config {}) :bin "claude") "RULES" "GO")]
      (should= "claude" (first args))
      (should= ["--allowedTools" "Bash(clj *)" "Bash(clojure *)" "Bash(./uml *)"
                "--permission-mode" "acceptEdits"
                "--append-system-prompt" "RULES" "GO"]
               (rest args))
      (should-not (some #{"--dangerously-skip-permissions"} args))))

  (it "skips all permission prompts only when asked"
    (should= ["claude" "--dangerously-skip-permissions" "--append-system-prompt" "RULES" "GO"]
             (agent/launch-args (assoc (agent/config {"UML_VIEWER_AGENT_YOLO" "1"}) :bin "claude")
                                "RULES" "GO"))
    (should= ["codex" "--dangerously-bypass-approvals-and-sandbox" "RULES\n\nGO"]
             (agent/launch-args (assoc (agent/config {"UML_VIEWER_AGENT" "codex"
                                                      "UML_VIEWER_AGENT_YOLO" "true"})
                                  :bin "codex")
                                "RULES" "GO")))

  (it "keeps Grok's original flags and theme"
    (let [cfg (assoc (agent/config {"UML_VIEWER_AGENT" "grok"}) :bin "grok")]
      (should= ["grok" "--yolo" "--trust" "--rules" "RULES" "GO"]
               (agent/launch-args cfg "RULES" "GO"))
      (should= ["-e" "GROK_THEME=terminal" "-e" "GROK_TERMINAL_THEME=1"
                "-e" "COLORTERM=truecolor"]
               (agent/session-env cfg "RULES" "GO"))))

  (it "passes the rules to Codex in its first prompt"
    (should= ["codex" "--full-auto" "RULES\n\nGO"]
             (agent/launch-args (assoc (agent/config {"UML_VIEWER_AGENT" "codex"}) :bin "codex")
                                "RULES" "GO")))

  (it "submits a wake-up with Enter, and Grok with Enter then LF"
    (should= [[:sleep 150] ["send-keys" "-t" "s" "C-m"]]
             (agent/submit-steps (agent/config {}) "s"))
    (should= [[:sleep 150] ["send-keys" "-t" "s" "C-m"]
              [:sleep 50] ["send-keys" "-t" "s" "C-j"]]
             (agent/submit-steps (agent/config {"UML_VIEWER_AGENT" "grok"}) "s"))))
