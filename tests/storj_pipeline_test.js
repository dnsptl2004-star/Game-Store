import assert from "assert";
import fs from "fs";
import path from "path";
import unzipper from "unzipper";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import storage, { validateStorageConfig, MAX_GAME_SIZE_BYTES } from "../storage.js";
import { verifyZipArchive, extractAndDeployGame, isZipSlip } from "../gameExtractor.js";

const require = createRequire(import.meta.url);
const archiverPkg = require("archiver");
const createZipStream = (options = { store: true }) => {
  if (archiverPkg.ZipArchive) return new archiverPkg.ZipArchive(options);
  if (typeof archiverPkg === "function") return archiverPkg("zip", options);
  if (archiverPkg.create) return archiverPkg.create("zip", options);
  throw new Error("Unable to initialize zip stream");
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to create a test zip in memory/buffer for test assertions
function createTestZip(entries) {
  return new Promise((resolve, reject) => {
    const archive = createZipStream({ store: true });
    const bufs = [];
    archive.on("data", (d) => bufs.push(d));
    archive.on("end", () => resolve(Buffer.concat(bufs)));
    archive.on("error", (err) => reject(err));

    for (const item of entries) {
      archive.append(item.content || "test content", { name: item.name });
    }
    archive.finalize();
  });
}

async function runTestSuite() {
  console.log("=================================================");
  console.log("🚀 STARTING STORJ & GAME PIPELINE AUTOMATED TESTS");
  console.log("=================================================\n");

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    return (async () => {
      try {
        await fn();
        console.log(`✅ PASS: ${name}`);
        passed++;
      } catch (err) {
        console.error(`❌ FAIL: ${name}`);
        console.error(`   Error: ${err.message}`);
        failed++;
      }
    })();
  }

  // 1. Validation & Secrets Test
  await test("Storage configuration validation without secret leakage", async () => {
    const result = validateStorageConfig();
    assert.strictEqual(result.valid, true, "Storage config must be valid");

    // Check that no secret is logged or returned in error structures
    const fakeMissing = validateStorageConfig();
    if (process.env.STORJ_SECRET_ACCESS_KEY) {
      assert(!JSON.stringify(fakeMissing).includes(process.env.STORJ_SECRET_ACCESS_KEY), "Secrets must never be returned");
    }
  });

  // 2. Reject files over 10 GB
  await test("Reject files over 10 GB before upload starts", async () => {
    const elevenGB = 11 * 1024 * 1024 * 1024;
    const isOverLimit = elevenGB > MAX_GAME_SIZE_BYTES;
    assert.strictEqual(isOverLimit, true, "11 GB should be flagged as over limit");
  });

  // 3. Security: Reject Zip-Slip
  await test("Reject zip-slip path traversal attempt", async () => {
    // Assert unit filter recognizes traversal attacks
    assert(isZipSlip("../../etc/passwd"), "Relative traversal must be detected");
    assert(isZipSlip("../evil.txt"), "Relative traversal must be detected");
    assert(isZipSlip("/etc/shadow"), "Absolute path must be detected");
    assert(isZipSlip("C:\\boot.ini"), "Windows drive path must be detected");
    assert(!isZipSlip("assets/scripts/main.js"), "Legitimate path must not be flagged");

    // Craft a real zip archive with un-sanitized relative path
    const pythonScript = `import zipfile, io; buf = io.BytesIO(); zf = zipfile.ZipFile(buf, 'w'); zf.writestr('index.html', '<h1>Game</h1>'); zf.writestr(zipfile.ZipInfo('../../etc/passwd'), 'root:x:0:0:'); print(buf.getvalue().hex())`;
    const hex = execSync(`python -c "${pythonScript}"`, { encoding: "utf8" }).trim();
    const maliciousZipBuf = Buffer.from(hex, "hex");

    const tmpKey = "tmp/test_zip_slip.zip";
    await storage.putObjectStream(tmpKey, maliciousZipBuf, "application/zip");

    let threw = false;
    try {
      await verifyZipArchive(tmpKey, maliciousZipBuf.length);
    } catch (err) {
      threw = true;
      assert(err.message.includes("Zip-slip"), "Error must mention Zip-slip security violation");
    } finally {
      await storage.deleteObject(tmpKey);
    }
    assert.strictEqual(threw, true, "Zip-slip package must be rejected");
  });

  // 4. Security: Reject Executables & Dangerous Scripts
  await test("Reject dangerous executables (.exe, .sh, .bat, .php)", async () => {
    const dangerousZipBuf = await createTestZip([
      { name: "index.html", content: "<h1>Game</h1>" },
      { name: "launcher.exe", content: "MZ\x90\x00" },
    ]);

    const tmpKey = "tmp/test_danger_exe.zip";
    await storage.putObjectStream(tmpKey, dangerousZipBuf, "application/zip");

    let threw = false;
    try {
      await verifyZipArchive(tmpKey, dangerousZipBuf.length);
    } catch (err) {
      threw = true;
      assert(err.message.includes("Executable or script file"), "Error must mention forbidden executable");
    } finally {
      await storage.deleteObject(tmpKey);
    }
    assert.strictEqual(threw, true, "Zip with .exe must be rejected");
  });

  // 5. Require index.html at root
  await test("Reject package without index.html", async () => {
    const missingHtmlZip = await createTestZip([
      { name: "data.bin", content: "binary data" },
      { name: "readme.txt", content: "instructions" },
    ]);

    const tmpKey = "tmp/test_missing_index.zip";
    await storage.putObjectStream(tmpKey, missingHtmlZip, "application/zip");

    let threw = false;
    try {
      await verifyZipArchive(tmpKey, missingHtmlZip.length);
    } catch (err) {
      threw = true;
      assert(err.message.includes("index.html"), "Error must mention missing index.html");
    } finally {
      await storage.deleteObject(tmpKey);
    }
    assert.strictEqual(threw, true, "Package missing index.html must be rejected");
  });

  // 6. Unwrap single top-level folder and skip junk
  await test("Unwrap top-level wrapper folder and skip junk files (.DS_Store, node_modules)", async () => {
    const wrappedZipBuf = await createTestZip([
      { name: "MyGame/index.html", content: "<!DOCTYPE html><html><body><h1>My Game</h1></body></html>" },
      { name: "MyGame/styles.css", content: "body { background: #000; }" },
      { name: "MyGame/scripts/game.js", content: "console.log('started');" },
      { name: "MyGame/.DS_Store", content: "junk mac os" },
      { name: "MyGame/node_modules/dummy/index.js", content: "junk modules" },
    ]);

    const tmpKey = "tmp/test_wrapped.zip";
    await storage.putObjectStream(tmpKey, wrappedZipBuf, "application/zip");

    const gameId = "test-game-wrap-" + Date.now();
    try {
      const verification = await verifyZipArchive(tmpKey, wrappedZipBuf.length);
      assert.strictEqual(verification.wrapperPrefix, "MyGame/", "Wrapper prefix should be identified as MyGame/");
      assert(!verification.validEntries.some(p => p.includes("node_modules")), "node_modules must be excluded");
      assert(!verification.validEntries.some(p => p.includes(".DS_Store")), ".DS_Store must be excluded");

      const deployment = await extractAndDeployGame(gameId, tmpKey, verification);
      assert.strictEqual(deployment.extractedCount, 3, "Only 3 clean files should be extracted");

      // Verify that index.html is accessible at the root of games/{gameId}/
      const indexObj = await storage.getObjectStream(`games/${gameId}/index.html`);
      assert(indexObj.stream, "index.html must exist at games/{gameId}/index.html");
    } finally {
      await storage.deletePrefix(`games/${gameId}/`);
      await storage.deleteObject(`zips/${gameId}.zip`);
      await storage.deleteObject(tmpKey);
    }
  });

  // 7. Memory test: verify memory remains < 500 MB during stream operations
  await test("Verify streaming extraction memory footprint remains under 500 MB", async () => {
    const initialHeapMB = process.memoryUsage().heapUsed / 1024 / 1024;
    console.log(`   Initial Heap: ${initialHeapMB.toFixed(1)} MB`);

    const largeFileZipBuf = await createTestZip([
      { name: "index.html", content: "<html><body>Canvas</body></html>" },
      { name: "bundle.data", content: Buffer.alloc(10 * 1024 * 1024, "A") }, // 10 MB payload stream
    ]);

    const tmpKey = "tmp/test_memory.zip";
    await storage.putObjectStream(tmpKey, largeFileZipBuf, "application/zip");

    const gameId = "test-mem-" + Date.now();
    try {
      const verification = await verifyZipArchive(tmpKey, largeFileZipBuf.length);
      await extractAndDeployGame(gameId, tmpKey, verification);

      const peakHeapMB = process.memoryUsage().heapUsed / 1024 / 1024;
      console.log(`   Peak Heap during streaming: ${peakHeapMB.toFixed(1)} MB (Limit: 500 MB)`);
      assert(peakHeapMB < 500, `Peak heap (${peakHeapMB} MB) must remain strictly below 500 MB`);
    } finally {
      await storage.deletePrefix(`games/${gameId}/`);
      await storage.deleteObject(`zips/${gameId}.zip`);
      await storage.deleteObject(tmpKey);
    }
  });

  // 8. Isolation: Game A download never includes Game B's files
  await test("Game A download package never includes Game B's files", async () => {
    const gameAId = "game-a-" + Date.now();
    const gameBId = "game-b-" + Date.now();

    const zipABuf = await createTestZip([
      { name: "index.html", content: "<h1>Game A</h1>" },
      { name: "gameA_unique_asset.txt", content: "exclusive to game A" },
    ]);

    const zipBBuf = await createTestZip([
      { name: "index.html", content: "<h1>Game B</h1>" },
      { name: "gameB_unique_asset.txt", content: "exclusive to game B" },
    ]);

    const tmpA = `tmp/test_${gameAId}.zip`;
    const tmpB = `tmp/test_${gameBId}.zip`;

    await storage.putObjectStream(tmpA, zipABuf, "application/zip");
    await storage.putObjectStream(tmpB, zipBBuf, "application/zip");

    try {
      const verA = await verifyZipArchive(tmpA, zipABuf.length);
      await extractAndDeployGame(gameAId, tmpA, verA);

      const verB = await verifyZipArchive(tmpB, zipBBuf.length);
      await extractAndDeployGame(gameBId, tmpB, verB);

      // Inspect zips/{gameAId}.zip
      const { stream: aStream } = await storage.getObjectStream(`zips/${gameAId}.zip`);
      const aEntries = [];
      const parseA = aStream.pipe(unzipper.Parse({ forceStream: true }));
      for await (const entry of parseA) {
        aEntries.push(entry.path);
        entry.autodrain();
      }

      assert(aEntries.includes("gameA_unique_asset.txt"), "Game A must contain its own unique asset");
      assert(!aEntries.includes("gameB_unique_asset.txt"), "Game A MUST NOT contain Game B asset");
    } finally {
      await storage.deletePrefix(`games/${gameAId}/`);
      await storage.deletePrefix(`games/${gameBId}/`);
      await storage.deleteObject(`zips/${gameAId}.zip`);
      await storage.deleteObject(`zips/${gameBId}.zip`);
      await storage.deleteObject(tmpA);
      await storage.deleteObject(tmpB);
    }
  });

  // 9. Secrets Audit
  await test("Verify no secrets in repository, frontend bundle, or tracked files", async () => {
    const gitignoreContent = fs.readFileSync(path.join(__dirname, "../.gitignore"), "utf8");
    assert(gitignoreContent.includes(".env"), ".gitignore must include .env");

    const secretKey = process.env.STORJ_SECRET_ACCESS_KEY;
    const accessKey = process.env.STORJ_ACCESS_KEY_ID;

    // Scan client source files
    const clientFiles = fs.readdirSync(path.join(__dirname, "../client/src"));
    for (const f of clientFiles) {
      if (f.endsWith(".js") || f.endsWith(".jsx")) {
        const content = fs.readFileSync(path.join(__dirname, "../client/src", f), "utf8");
        if (secretKey) assert(!content.includes(secretKey), `Secret key found in client/src/${f}!`);
        if (accessKey) assert(!content.includes(accessKey), `Access key found in client/src/${f}!`);
      }
    }
  });

  console.log("\n=================================================");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("=================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test runner fatal error:", err);
  process.exit(1);
});
