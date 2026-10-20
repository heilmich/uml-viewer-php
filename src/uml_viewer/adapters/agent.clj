(ns uml-viewer.adapters.agent
  "The companion agent the viewer starts in tmux: which CLI, its argv,
  and the keys that submit a wake-up. `UML_VIEWER_AGENT` picks a preset
  (`claude`, the default; `grok`; `codex`). `UML_VIEWER_AGENT_CMD` runs
  any shell command instead, with the rules and launch prompt in
  `UML_VIEWER_RULES` and `UML_VIEWER_PROMPT`."
  (:require [clojure.java.io :as io]
            [clojure.string :as str]))

(def default-agent :claude)

(def presets
  {:claude {:label "Claude Code"
            :bin-env "CLAUDE_BIN"
            :bins ["~/.claude/local/claude" "~/.local/bin/claude"
                   "/usr/local/bin/claude" "/opt/homebrew/bin/claude"]
            :fallback "claude"}
   :grok {:label "Grok"
          :bin-env "GROK_BIN"
          :bins ["~/.grok/bin/grok" "/usr/local/bin/grok" "/opt/homebrew/bin/grok"]
          :fallback "grok"
          :env ["GROK_THEME=terminal" "GROK_TERMINAL_THEME=1"]}
   :codex {:label "Codex"
           :bin-env "CODEX_BIN"
           :bins ["~/.local/bin/codex" "/usr/local/bin/codex" "/opt/homebrew/bin/codex"]
           :fallback "codex"}})

(def claude-allowed-tools
  "Commands the Claude companion runs without asking: IR, CRAP, mutation,
  and the viewer restart."
  ["Bash(clj *)" "Bash(clojure *)" "Bash(./uml *)"])

(defn- expand-home [path home]
  (if (and home (str/starts-with? path "~/"))
    (str home (subs path 1))
    path))

(defn- executable? [path]
  (let [f (io/file path)]
    (and (.isFile f) (.canExecute f))))

(defn executable
  "First executable candidate for `preset`: `UML_VIEWER_AGENT_BIN`, the
  preset's own variable (e.g. `GROK_BIN`), then the usual install paths.
  Falls back to the bare name, found on PATH."
  [preset env]
  (let [home (get env "HOME")
        named (keep #(not-empty (get env %)) ["UML_VIEWER_AGENT_BIN" (:bin-env preset)])
        candidates (concat named (map #(expand-home % home) (:bins preset)))]
    (or (first (filter executable? candidates))
        (first named)
        (:fallback preset))))

(defn- truthy? [s]
  (contains? #{"1" "true" "yes" "on"} (str/lower-case (str s))))

(defn config
  "Companion agent chosen by the environment `env` (default: the process
  environment). Throws on an unknown `UML_VIEWER_AGENT`."
  ([] (config (System/getenv)))
  ([env]
   (let [cmd (get env "UML_VIEWER_AGENT_CMD")
         named (some-> (get env "UML_VIEWER_AGENT") str/trim str/lower-case not-empty)
         agent (if named (keyword named) default-agent)]
     (cond
       (not (str/blank? cmd))
       {:agent :custom :label "agent" :cmd cmd}

       (contains? presets agent)
       (let [preset (get presets agent)]
         (assoc preset
           :agent agent
           :bin (executable preset env)
           :yolo? (truthy? (get env "UML_VIEWER_AGENT_YOLO"))))

       :else
       (throw (ex-info (str "unknown UML_VIEWER_AGENT " (pr-str named)
                            "; use claude, grok, codex, or UML_VIEWER_AGENT_CMD")
                       {:agent named}))))))

(defn launch-args
  "Command line that starts the agent with standing `rules` and `prompt`."
  [cfg rules prompt]
  (case (:agent cfg)
    :claude (if (:yolo? cfg)
              [(:bin cfg) "--dangerously-skip-permissions"
               "--append-system-prompt" rules prompt]
              (into [(:bin cfg) "--allowedTools"]
                    (concat claude-allowed-tools
                            ["--permission-mode" "acceptEdits"
                             "--append-system-prompt" rules prompt])))
    :grok [(:bin cfg) "--yolo" "--trust" "--rules" rules prompt]
    :codex [(:bin cfg)
            (if (:yolo? cfg) "--dangerously-bypass-approvals-and-sandbox" "--full-auto")
            (str rules "\n\n" prompt)]
    :custom ["sh" "-c" (:cmd cfg)]))

(defn session-env
  "`-e NAME=value` pairs for `tmux new-session`."
  [cfg rules prompt]
  (let [vars (concat (:env cfg)
                     ["COLORTERM=truecolor"]
                     (when (= :custom (:agent cfg))
                       [(str "UML_VIEWER_RULES=" rules)
                        (str "UML_VIEWER_PROMPT=" prompt)]))]
    (vec (mapcat (fn [v] ["-e" v]) vars))))

(defn submit-steps
  "Steps after the wake-up text is typed. Grok wants CR then LF, as in
  SwarmForge; the others submit on Enter alone."
  [cfg session]
  (if (= :grok (:agent cfg))
    [[:sleep 150]
     ["send-keys" "-t" session "C-m"]
     [:sleep 50]
     ["send-keys" "-t" session "C-j"]]
    [[:sleep 150]
     ["send-keys" "-t" session "C-m"]]))
