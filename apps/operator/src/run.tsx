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
  | { type: "tournaments"; operation: "publish" | "start"; tournaments: DiscoveredTournament[] }
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

  const discover = async (operation: "publish" | "start"): Promise<void> => {
    if (config === undefined) return;
    setScreen({ type: "loading", label: "Discovering CS2 tournaments..." });
    try {
      const output = await runRemote(config, remoteScriptPath, "discover-cs2");
      setScreen({ type: "tournaments", operation, tournaments: parseDiscovery(output) });
    } catch (error) {
      setScreen({ type: "output", title: "Discovery failed", lines: [error instanceof Error ? error.message : String(error)], failed: true });
    }
  };

  const menuItems: ListItem<string>[] = [
    { label: "Refresh status", value: "status" },
    { label: "Publish upcoming tournament", value: "publish", disabled: status?.mode !== "catalog" },
    { label: "Start upcoming Series", value: "start", disabled: status?.mode !== "catalog" },
    { label: "Start by exact Series ID", value: "start-id", disabled: status?.mode !== "catalog" },
    { label: "Stop active Series", value: "stop", disabled: status?.mode !== "live" },
    { label: "Recent CS2 logs", value: "logs" },
    { label: "Exit", value: "exit" },
  ];

  const chooseMenu = (choice: string): void => {
    if (choice === "exit") return exit();
    if (choice === "publish" || choice === "start") return void discover(choice);
    if (choice === "start-id") return setScreen({ type: "series-id", value: "" });
    if (choice === "stop" && status !== undefined) {
      const id = status.seriesId;
      setScreen({ type: "confirm", operation: {
        title: "Stop active CS2 Series",
        details: [`Series: ${id}`, `Mode: ${status.mode}`, `Unfinished Arenas: ${status.unfinishedArenas}`],
        command: "stop-cs2",
        argument: id,
        confirmation: `STOP CS2 ${id}`,
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
        if (screen.operation === "start") return setScreen({ type: "series", tournament });
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
        label: `${series.teams}  ${new Date(series.scheduledStartTime).toLocaleString()}  Bo${series.format}  ${series.selectable ? series.serviceLevel : series.reason}  [${series.id}]`,
        value: series,
        disabled: !series.selectable,
      }))}
      onCancel={() => setScreen({ type: "menu" })}
      onSelect={(series: DiscoveredSeries) => setScreen({ type: "confirm", operation: {
        title: "Start CS2 Series",
        details: [`Tournament: ${screen.tournament.name}`, `Series: ${series.teams}`, `GRID Series ID: ${series.id}`, `Schedule: ${new Date(series.scheduledStartTime).toLocaleString()}`],
        command: "start-cs2",
        argument: series.id,
        confirmation: `START CS2 ${series.id}`,
      } })}
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
          if (!series.selectable) throw new Error(`GRID Series ${id} cannot start: ${series.reason}`);
          setScreen({ type: "confirm", operation: {
            title: "Start CS2 Series",
            details: [
              `Tournament: ${series.tournamentName}`,
              `Series: ${series.teams}`,
              `GRID Series ID: ${id}`,
              `Schedule: ${new Date(series.scheduledStartTime).toLocaleString()} | Bo${series.format} | ${series.serviceLevel}`,
            ],
            command: "start-cs2",
            argument: id,
            confirmation: `START CS2 ${id}`,
          } });
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
    {status !== undefined && <Text dimColor>Mode: {status.mode} | Health: {status.appHealth} | Series: {status.seriesId || "none"} | Rev: {status.revision.slice(0, 8)}</Text>}
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
