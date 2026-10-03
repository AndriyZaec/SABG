import { Box, Text, render, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { fileURLToPath } from "node:url";
import { useEffect, useState } from "react";
import {
  assertGridId,
  loadOperatorConfig,
  parseDiscovery,
  parseDiscoverySeries,
  parseRuntimeStatus,
  runRemote,
  type DiscoveredSeries,
  type DiscoveredTournament,
  type OperatorConfig,
  type RemoteCommand,
  type RuntimeStatus,
} from "./operator.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const configPath = process.env.EVENT_CONTROL_ENV_FILE ?? `${root}/deploy/event-control.env`;
const remoteScriptPath = `${root}/deploy/remote-event-control.sh`;

type PendingOperation = {
  title: string;
  details: string[];
  command: RemoteCommand;
  argument?: string;
  confirmation?: string;
};

type Screen =
  | { type: "loading"; label: string }
  | { type: "menu" }
  | { type: "tournaments"; operation: "publish" | "prioritize"; tournaments: DiscoveredTournament[] }
  | { type: "series"; tournament: DiscoveredTournament }
  | { type: "series-id"; value: string }
  | { type: "confirm"; operation: PendingOperation }
  | { type: "output"; title: string; lines: string[]; failed: boolean; running?: boolean };

interface ListItem<T> {
  label: string;
  value: T;
  disabled?: boolean;
}

function SelectList<T>({ items, onSelect, onCancel }: {
  items: ListItem<T>[];
  onSelect: (value: T) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [index, setIndex] = useState(0);
  useInput((input, key) => {
    if (input === "q" || key.escape) return onCancel();
    if (key.upArrow || input === "k") setIndex((current) => (current - 1 + items.length) % items.length);
    if (key.downArrow || input === "j") setIndex((current) => (current + 1) % items.length);
    if (key.return) {
      const selected = items[index];
      if (selected !== undefined && !selected.disabled) onSelect(selected.value);
    }
  });
  return <Box flexDirection="column">
    {items.map((item, itemIndex) => <Text key={itemIndex} dimColor={item.disabled} color={itemIndex === index ? "green" : undefined} bold={itemIndex === index}>
      {itemIndex === index ? "> " : "  "}{item.label}
    </Text>)}
    <Text dimColor>Up/Down or j/k to move, Enter to select, q to return</Text>
  </Box>;
}

function Confirmation({ operation, onYes, onNo }: {
  operation: PendingOperation;
  onYes: () => void;
  onNo: () => void;
}): React.JSX.Element {
  useInput((input) => {
    if (input.toLowerCase() === "y") onYes();
    else onNo();
  });
  return <Box flexDirection="column">
    <Text bold color="yellow">{operation.title}</Text>
    {operation.details.map((detail) => <Text key={detail}>{detail}</Text>)}
    <Text>Continue? [y/N]</Text>
  </Box>;
}

function App(): React.JSX.Element {
  const { exit } = useApp();
  const [config, setConfig] = useState<OperatorConfig>();
  const [status, setStatus] = useState<RuntimeStatus>();
  const [screen, setScreen] = useState<Screen>({ type: "loading", label: "Loading operator status..." });

  const execute = async (operation: PendingOperation): Promise<void> => {
    if (config === undefined) return;
    const lines: string[] = [];
    setScreen({ type: "output", title: operation.title, lines, failed: false, running: true });
    try {
      const output = await runRemote(
        config,
        remoteScriptPath,
        operation.command,
        operation.argument,
        operation.confirmation,
        (chunk) => {
          lines.push(...chunk.split(/\r?\n/u).filter(Boolean));
          setScreen({ type: "output", title: operation.title, lines: lines.slice(-30), failed: false, running: true });
        },
      );
      let refreshWarning = "";
      if (operation.command !== "logs" && operation.command !== "status") {
        try {
          setStatus(parseRuntimeStatus(await runRemote(config, remoteScriptPath, "status")));
        } catch {
          refreshWarning = "Status refresh failed; the operation itself completed successfully.";
        }
      } else if (operation.command === "status") {
        setStatus(parseRuntimeStatus(output));
      }
      const outputLines = output.split(/\r?\n/u).filter(Boolean);
      if (refreshWarning !== "") outputLines.push(refreshWarning);
      setScreen({ type: "output", title: operation.title, lines: outputLines.slice(-30), failed: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setScreen({ type: "output", title: operation.title, lines: message.split(/\r?\n/u).slice(-30), failed: true });
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await loadOperatorConfig(configPath);
        setConfig(loaded);
        const current = parseRuntimeStatus(await runRemote(loaded, remoteScriptPath, "status"));
        setStatus(current);
        setScreen({ type: "menu" });
      } catch (error) {
        setScreen({
          type: "output",
          title: "Could not start operator",
          lines: [error instanceof Error ? error.message : String(error)],
          failed: true,
        });
      }
    })();
  }, []);

  const discover = async (operation: "publish" | "prioritize"): Promise<void> => {
    if (config === undefined) return;
    setScreen({ type: "loading", label: "Discovering CS2 tournaments..." });
    try {
      const output = await runRemote(config, remoteScriptPath, "discover-cs2");
      let tournaments = parseDiscovery(output);
      if (operation === "prioritize") {
        // Only a published tournament's series exist in the database, so only they can take a priority.
        const published = new Set((status?.tournamentId ?? "").split(",").filter((id) => id !== ""));
        tournaments = tournaments.filter((tournament) => published.has(tournament.id));
        if (tournaments.length === 0) throw new Error("No published tournament has upcoming Series; publish one first");
      }
      setScreen({ type: "tournaments", operation, tournaments });
    } catch (error) {
      setScreen({ type: "output", title: "Discovery failed", lines: [error instanceof Error ? error.message : String(error)], failed: true });
    }
  };

  const running = status?.runningSeries[0];
  const autopilotOn = status?.autopilot === "on";
  const menuItems: ListItem<string>[] = [
    { label: "Refresh status", value: "status" },
    { label: autopilotOn ? "Turn autopilot off" : "Turn autopilot on", value: "autopilot", disabled: status?.autopilot === "unknown" },
    { label: "Prioritize or unprioritize an upcoming Series", value: "prioritize" },
    { label: "Prioritize or unprioritize by exact Series ID", value: "prioritize-id" },
    { label: `Skip running Series${running === undefined ? "" : ` ${running}`}`, value: "skip", disabled: running === undefined },
    { label: "Publish upcoming tournament", value: "publish", disabled: running !== undefined },
    { label: "Recent CS2 logs", value: "logs" },
    { label: "Exit", value: "exit" },
  ];

  const confirmPriority = (id: string, details: string[]): void => {
    const prioritized = status?.prioritySeries.includes(id) === true;
    setScreen({ type: "confirm", operation: {
      title: prioritized ? "Remove CS2 Series priority" : "Prioritize CS2 Series",
      details: [...details, prioritized
        ? "It no longer wins a tie on start time."
        : "It wins a tie on start time; an earlier Series still goes first."],
      command: prioritized ? "unprioritize-cs2" : "prioritize-cs2",
      argument: id,
    } });
  };

  const chooseMenu = (choice: string): void => {
    if (choice === "exit") return exit();
    if (choice === "publish" || choice === "prioritize") return void discover(choice);
    if (choice === "prioritize-id") return setScreen({ type: "series-id", value: "" });
    if (choice === "autopilot") {
      setScreen({ type: "confirm", operation: autopilotOn
        ? { title: "Turn autopilot off", details: ["The running Series plays to its end; no new Series launch."], command: "autopilot-off" }
        : { title: "Turn autopilot on", details: ["The next due Series launches within a minute."], command: "autopilot-on" } });
      return;
    }
    if (choice === "skip" && running !== undefined) {
      setScreen({ type: "confirm", operation: {
        title: "Skip running CS2 Series",
        details: [
          `Series: ${running}`,
          `Unfinished Arenas: ${status?.unfinishedArenas ?? "unknown"}`,
          "Refused if any player paid to enter its open arena.",
        ],
        command: "skip-cs2",
        argument: running,
        confirmation: `SKIP CS2 ${running}`,
      } });
      return;
    }
    void execute({
      title: choice === "logs" ? "Recent CS2 logs" : "Refresh status",
      details: [],
      command: choice === "logs" ? "logs" : "status",
    });
  };

  let content: React.JSX.Element;
  if (screen.type === "loading") {
    content = <Text color="cyan">{screen.label}</Text>;
  } else if (screen.type === "menu") {
    content = <SelectList items={menuItems} onSelect={chooseMenu} onCancel={exit} />;
  } else if (screen.type === "tournaments") {
    const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
    content = <SelectList
      items={screen.tournaments.map((tournament) => ({
        label: `${formatter.format(new Date(tournament.scheduledStartTime))}  ${tournament.name} (${tournament.series.length} Series)`,
        value: tournament,
        disabled: screen.operation === "publish" && !tournament.series.some((series) => series.selectable),
      }))}
      onCancel={() => setScreen({ type: "menu" })}
      onSelect={(tournament) => {
        if (screen.operation === "prioritize") return setScreen({ type: "series", tournament });
        const series = tournament.series.find((item) => item.selectable);
        if (series === undefined) return;
        setScreen({ type: "confirm", operation: {
          title: "Publish CS2 tournament",
          details: [`Tournament: ${tournament.name}`, `Tournament ID: ${tournament.id}`, `Series discovered: ${tournament.series.length}`],
          command: "publish-cs2",
          argument: series.id,
          confirmation: `PUBLISH CS2 ${tournament.id}`,
        } });
      }}
    />;
  } else if (screen.type === "series") {
    content = <SelectList
      items={screen.tournament.series.map((series) => ({
        label: `${status?.prioritySeries.includes(series.id) === true ? "* " : ""}${series.teams}  ${new Date(series.scheduledStartTime).toLocaleString()}  Bo${series.format}  ${series.selectable ? series.serviceLevel : series.reason}  [${series.id}]`,
        value: series,
      }))}
      onCancel={() => setScreen({ type: "menu" })}
      onSelect={(series: DiscoveredSeries) => confirmPriority(series.id, [
        `Tournament: ${screen.tournament.name}`,
        `Series: ${series.teams}`,
        `GRID Series ID: ${series.id}`,
        `Schedule: ${new Date(series.scheduledStartTime).toLocaleString()}`,
      ])}
    />;
  } else if (screen.type === "series-id") {
    content = <Box flexDirection="column">
      <Text>GRID Series ID:</Text>
      <TextInput value={screen.value} onChange={(value) => setScreen({ type: "series-id", value })} onSubmit={(value) => {
        if (config === undefined) return;
        void (async () => {
        try {
          const id = assertGridId(value.trim());
          setScreen({ type: "loading", label: `Looking up GRID Series ${id}...` });
          const discovered = parseDiscoverySeries(await runRemote(config, remoteScriptPath, "inspect-cs2", id));
          const series = discovered.find((item) => item.id === id);
          if (series === undefined) throw new Error(`GRID Series ${id} was not found in the discovery window`);
          confirmPriority(id, [
            `Tournament: ${series.tournamentName}`,
            `Series: ${series.teams}`,
            `GRID Series ID: ${id}`,
            `Schedule: ${new Date(series.scheduledStartTime).toLocaleString()} | Bo${series.format} | ${series.selectable ? series.serviceLevel : series.reason}`,
          ]);
        } catch (error) {
          setScreen({ type: "output", title: "Series lookup failed", lines: [error instanceof Error ? error.message : String(error)], failed: true });
        }
        })();
      }} />
    </Box>;
  } else if (screen.type === "confirm") {
    content = <Confirmation operation={screen.operation} onYes={() => void execute(screen.operation)} onNo={() => setScreen({ type: "menu" })} />;
  } else {
    content = <Box flexDirection="column">
      <Text bold color={screen.failed ? "red" : "green"}>{screen.title}</Text>
      {screen.lines.map((line, index) => <Text key={index}>{line}</Text>)}
      {screen.running === true
        ? <Text dimColor>Operation running...</Text>
        : <>
          <Text dimColor>Press Enter to return, q to exit</Text>
          <OutputInput onReturn={() => setScreen({ type: "menu" })} onExit={exit} />
        </>}
    </Box>;
  }

  return <Box flexDirection="column" paddingX={1}>
    <Text bold color="cyan">SABG CS2 Operator</Text>
    {status !== undefined && <Text dimColor>Autopilot: {status.autopilot} | Health: {status.appHealth} | Running: {status.runningSeries.join(", ") || "none"} | Priority: {status.prioritySeries.join(", ") || "none"} | Rev: {status.revision.slice(0, 8)}</Text>}
    <Box marginTop={1} flexDirection="column">{content}</Box>
  </Box>;
}

function OutputInput({ onReturn, onExit }: { onReturn: () => void; onExit: () => void }): null {
  useInput((input, key) => {
    if (input === "q") onExit();
    else if (key.return) onReturn();
  });
  return null;
}

const alternateScreen = process.stdout.isTTY;
const leaveAlternateScreen = (): void => {
  if (alternateScreen) process.stdout.write("\u001B[?1049l");
};

if (alternateScreen) process.stdout.write("\u001B[?1049h\u001B[2J\u001B[H");
process.once("exit", leaveAlternateScreen);

const tui = render(<App />);
try {
  await tui.waitUntilExit();
} finally {
  process.removeListener("exit", leaveAlternateScreen);
  leaveAlternateScreen();
}
