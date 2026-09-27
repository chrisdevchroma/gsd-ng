'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const OPENCODE = process.env.OPENCODE_BIN || 'opencode';
const EXPECTED_VERSION = 'opencode v2.0.18';
const REPO_ROOT = path.resolve(__dirname, '..');
const INSTALLER = path.join(REPO_ROOT, 'bin', 'install.js');
const TMP_BASE = fs.existsSync('/tmp/opencode') ? '/tmp/opencode' : require('node:os').tmpdir();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || REPO_ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    timeout: options.timeout || 120000,
  });
  if (result.error || result.status !== 0) {
    const detail = [
      `${command} ${args.join(' ')} failed`,
      result.error && result.error.stack,
      result.stdout,
      result.stderr,
    ]
      .filter(Boolean)
      .join('\n');
    throw new Error(detail);
  }
  return result.stdout;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}\n${text}`);
  }
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (server.exitCode === null) server.kill('SIGKILL');
}

async function main() {
  assert.equal(run(OPENCODE, ['--version']).trim(), EXPECTED_VERSION);

  const root = fs.mkdtempSync(path.join(TMP_BASE, 'gsd-opencode-v2-'));
  const project = path.join(root, 'project');
  const xdgConfig = path.join(root, 'xdg-config');
  const xdgData = path.join(root, 'xdg-data');
  const xdgCache = path.join(root, 'xdg-cache');
  const configHome = path.join(project, '.opencode');
  const password = `gsd-live-${process.pid}`;
  const serverLog = path.join(root, 'opencode-server.log');
  let server;
  let logFd;

  try {
    for (const dir of [project, xdgConfig, xdgData, xdgCache]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    run('git', ['init', '--quiet'], { cwd: project });
    run(
      process.execPath,
      [
        INSTALLER,
        '--runtime',
        'opencode',
        '--local',
        '--no-seed-permissions-config',
        '--no-seed-sandbox-config',
      ],
      { cwd: project },
    );

    const manifestPath = path.join(configHome, 'gsd-ng', 'opencode-commands.json');
    const manifest = parseJson(fs.readFileSync(manifestPath, 'utf8'), 'command manifest');
    const expectedNames = manifest.commands.map((record) => record.name).sort();
    assert.ok(expectedNames.length > 30, 'the installed public command surface is unexpectedly small');
    assert.equal(new Set(expectedNames).size, expectedNames.length, 'manifest command names must be unique');
    assert.ok(
      manifest.commands.some(
        (record) =>
          record.name === 'gsd-plan-phase' &&
          record.route.kind === 'planner' &&
          record.route.agent === 'gsd-planner',
      ),
      'the installed planner route is missing',
    );

    for (const directory of ['command', 'commands']) {
      for (const name of expectedNames) {
        assert.ok(
          !fs.existsSync(path.join(configHome, directory, `${name}.md`)),
          `${directory}/${name}.md must not reach native command discovery`,
        );
      }
    }
    assert.ok(fs.existsSync(path.join(configHome, 'plugins', 'gsd-core.js')));
    assert.ok(!fs.existsSync(path.join(configHome, 'plugin', 'gsd-core.js')));

    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      XDG_CONFIG_HOME: xdgConfig,
      XDG_DATA_HOME: xdgData,
      XDG_CACHE_HOME: xdgCache,
      OPENCODE_PASSWORD: password,
    };
    const apiArgs = ['api', '--server', baseUrl];
    const api = (operation, args = []) =>
      run(OPENCODE, [...apiArgs, operation, ...args], {
        cwd: project,
        env,
        timeout: 180000,
      });

    logFd = fs.openSync(serverLog, 'w');
    server = spawn(
      OPENCODE,
      [
        'serve',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(port),
        '--print-logs',
        '--log-level',
        'debug',
      ],
      { cwd: project, env, stdio: ['ignore', logFd, logFd] },
    );

    let ready = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (server.exitCode !== null) break;
      const health = spawnSync(
        OPENCODE,
        [
          ...apiArgs,
          'command.list',
          '--param',
          `location[directory]=${project}`,
        ],
        {
        cwd: project,
        env,
        encoding: 'utf8',
        timeout: 5000,
        },
      );
      if (health.status === 0) {
        ready = true;
        break;
      }
      sleep(250);
    }
    assert.ok(ready, 'the private OpenCode API server did not become ready');

    const created = parseJson(
      api('session.create', [
        '--data',
        JSON.stringify({
          title: 'GSD v2 command verification',
          location: { directory: project },
        }),
      ]),
      'session.create',
    );
    const parentID = created.data && created.data.id;
    assert.match(parentID, /^ses/);

    api('session.command', [
      '--param',
      `sessionID=${parentID}`,
      '--data',
      JSON.stringify({
        name: 'gsd-plan-phase',
        text: '1',
        delivery: 'queue',
      }),
    ]);

    const commands = parseJson(
      api('command.list', ['--param', `location[directory]=${project}`]),
      'command.list',
    ).data;
    const registeredNames = commands
      .map((command) => command.name)
      .filter((name) => name.startsWith('gsd-'))
      .sort();
    assert.deepEqual(registeredNames, expectedNames);

    const sessions = parseJson(
      api('session.list', [
        '--param',
        `location[directory]=${project}`,
        '--param',
        'limit=20',
      ]),
      'session.list',
    ).data;
    const plannerChildren = sessions.filter(
      (session) => session.id !== parentID && session.agent === 'gsd-planner',
    );
    assert.equal(plannerChildren.length, 1, 'planner invocation must create one gsd-planner child');
    assert.equal(plannerChildren[0].outcome, 'succeeded');

    const childContext = parseJson(
      api('session.context', [
        '--param',
        `sessionID=${plannerChildren[0].id}`,
      ]),
      'child session.context',
    ).data;
    assert.ok(
      childContext.some(
        (message) =>
          message.type === 'agent-switched' && message.agent === 'gsd-planner',
      ),
      'child context must record gsd-planner selection',
    );
    assert.ok(
      childContext.some(
        (message) => message.type === 'assistant' && message.agent === 'gsd-planner',
      ),
      'child context must contain a gsd-planner completion',
    );

    const parentContext = parseJson(
      api('session.context', ['--param', `sessionID=${parentID}`]),
      'parent session.context',
    ).data;
    assert.deepEqual(
      parentContext.map((message) => message.text),
      [JSON.stringify(childContext)],
      'the parent must receive only the synthetic child result',
    );

    console.log(`PASS ${EXPECTED_VERSION}`);
    console.log(`PASS plugin commands registered: ${registeredNames.length}`);
    console.log(`PASS native GSD command files: 0`);
    console.log(`PASS planner child: ${plannerChildren[0].id} agent=gsd-planner`);
    console.log(`PASS parent synthetic results: ${parentContext.length}`);
  } catch (error) {
    if (fs.existsSync(serverLog)) {
      process.stderr.write(`\n--- OpenCode server log ---\n${fs.readFileSync(serverLog, 'utf8')}\n`);
    }
    throw error;
  } finally {
    await stopServer(server);
    if (logFd !== undefined) fs.closeSync(logFd);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
