import type { FilePath, UXFileInfoStub, UXInternalFileInfoStub } from "@lib/common/types";
import type { FileEventItem } from "@lib/common/types";
import type { IStorageEventManagerAdapter } from "@lib/managers/adapters";
import type {
    IStorageEventTypeGuardAdapter,
    IStorageEventPersistenceAdapter,
    IStorageEventWatchAdapter,
    IStorageEventStatusAdapter,
    IStorageEventConverterAdapter,
    IStorageEventWatchHandlers,
} from "@lib/managers/adapters";
import type { FileEventItemSentinel } from "@lib/managers/StorageEventManager";
import type { NodeFile, NodeFolder } from "../adapters/NodeTypes";
import * as fs from "fs/promises";
import * as path from "path";
import { watch } from "chokidar";
import type { FSWatcher } from "chokidar";

/**
 * CLI-specific type guard adapter
 */
class CLITypeGuardAdapter implements IStorageEventTypeGuardAdapter<NodeFile, NodeFolder> {
    isFile(file: any): file is NodeFile {
        return file && typeof file === "object" && "path" in file && "stat" in file && !file.isFolder;
    }

    isFolder(item: any): item is NodeFolder {
        return item && typeof item === "object" && "path" in item && item.isFolder === true;
    }
}

/**
 * CLI-specific persistence adapter (file-based snapshot)
 */
class CLIPersistenceAdapter implements IStorageEventPersistenceAdapter {
    private snapshotPath: string;

    constructor(basePath: string) {
        this.snapshotPath = path.join(basePath, ".livesync-snapshot.json");
    }

    async saveSnapshot(snapshot: (FileEventItem | FileEventItemSentinel)[]): Promise<void> {
        try {
            await fs.writeFile(this.snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
        } catch (error) {
            console.error("Failed to save snapshot:", error);
        }
    }

    async loadSnapshot(): Promise<(FileEventItem | FileEventItemSentinel)[] | null> {
        try {
            const content = await fs.readFile(this.snapshotPath, "utf-8");
            return JSON.parse(content);
        } catch {
            return null;
        }
    }
}

/**
 * CLI-specific status adapter (console logging)
 */
class CLIStatusAdapter implements IStorageEventStatusAdapter {
    private lastUpdate = 0;
    private updateInterval = 5000; // Update every 5 seconds

    updateStatus(status: { batched: number; processing: number; totalQueued: number }): void {
        const now = Date.now();
        if (now - this.lastUpdate > this.updateInterval) {
            if (status.totalQueued > 0 || status.processing > 0) {
                // console.log(
                //     `[StorageEventManager] Batched: ${status.batched}, Processing: ${status.processing}, Total Queued: ${status.totalQueued}`
                // );
            }
            this.lastUpdate = now;
        }
    }
}

/**
 * CLI-specific converter adapter
 */
class CLIConverterAdapter implements IStorageEventConverterAdapter<NodeFile> {
    toFileInfo(file: NodeFile, deleted?: boolean): UXFileInfoStub {
        return {
            name: path.basename(file.path),
            path: file.path,
            stat: file.stat,
            deleted: deleted,
            isFolder: false,
        };
    }

    toInternalFileInfo(p: FilePath): UXInternalFileInfoStub {
        return {
            name: path.basename(p),
            path: p,
            isInternal: true,
            stat: undefined,
        };
    }
}

/**
 * Node.js-specific watch adapter using chokidar for file watching
 */
class NodeWatchAdapter implements IStorageEventWatchAdapter {
    private watcher?: FSWatcher;
    private basePath: string;
    private ignorePatterns: string[];

    constructor(basePath: string, ignorePatterns: string[] = []) {
        this.basePath = basePath;
        this.ignorePatterns = ignorePatterns;
    }

    async beginWatch(handlers: IStorageEventWatchHandlers): Promise<void> {
        console.log(`[NodeWatchAdapter] Starting file watcher for: ${this.basePath}`);
        console.log(`[NodeWatchAdapter] Ignore patterns: ${this.ignorePatterns.join(", ")}`);

        this.watcher = watch(this.basePath, {
            ignored: this.ignorePatterns,
            persistent: true,
            ignoreInitial: false, // Process existing files on startup
            awaitWriteFinish: {
                stabilityThreshold: 500, // Wait 500ms after last write
                pollInterval: 100,
            },
        });

        this.watcher
            .on("add", async (filePath) => {
                const relativePath = path.relative(this.basePath, filePath).replace(/\\/g, "/");
                console.log(`[NodeWatchAdapter] File created: ${relativePath}`);

                try {
                    const stat = await fs.stat(filePath);
                    const nodeFile: NodeFile = {
                        path: relativePath as FilePath,
                        stat: {
                            size: stat.size,
                            mtime: stat.mtimeMs,
                            ctime: stat.ctimeMs,
                            type: "file",
                        },
                    };
                    await handlers.onCreate(nodeFile);
                } catch (error) {
                    console.error(`[NodeWatchAdapter] Error handling create for ${relativePath}:`, error);
                }
            })
            .on("change", async (filePath) => {
                const relativePath = path.relative(this.basePath, filePath).replace(/\\/g, "/");
                console.log(`[NodeWatchAdapter] File changed: ${relativePath}`);

                try {
                    const stat = await fs.stat(filePath);
                    const nodeFile: NodeFile = {
                        path: relativePath as FilePath,
                        stat: {
                            size: stat.size,
                            mtime: stat.mtimeMs,
                            ctime: stat.ctimeMs,
                            type: "file",
                        },
                    };
                    await handlers.onChange(nodeFile, undefined);
                } catch (error) {
                    console.error(`[NodeWatchAdapter] Error handling change for ${relativePath}:`, error);
                }
            })
            .on("unlink", async (filePath) => {
                const relativePath = path.relative(this.basePath, filePath).replace(/\\/g, "/");
                console.log(`[NodeWatchAdapter] File deleted: ${relativePath}`);

                const nodeFile: NodeFile = {
                    path: relativePath as FilePath,
                    stat: {
                        size: 0,
                        mtime: Date.now(),
                        ctime: Date.now(),
                        type: "file",
                    },
                };
                await handlers.onDelete(nodeFile);
            })
            .on("error", (error) => {
                console.error(`[NodeWatchAdapter] Watcher error:`, error);
            })
            .on("ready", () => {
                console.log(`[NodeWatchAdapter] File watcher ready - monitoring changes`);
            });

        return Promise.resolve();
    }

    async endWatch(): Promise<void> {
        if (this.watcher) {
            console.log("[NodeWatchAdapter] Stopping file watcher");
            await this.watcher.close();
            this.watcher = undefined;
        }
    }
}

/**
 * Composite adapter for CLI StorageEventManager
 */
export class CLIStorageEventManagerAdapter implements IStorageEventManagerAdapter<NodeFile, NodeFolder> {
    readonly typeGuard: CLITypeGuardAdapter;
    readonly persistence: CLIPersistenceAdapter;
    readonly watch: NodeWatchAdapter;
    readonly status: CLIStatusAdapter;
    readonly converter: CLIConverterAdapter;

    constructor(basePath: string, ignorePatterns: string[] = []) {
        this.typeGuard = new CLITypeGuardAdapter();
        this.persistence = new CLIPersistenceAdapter(basePath);
        this.watch = new NodeWatchAdapter(basePath, ignorePatterns);
        this.status = new CLIStatusAdapter();
        this.converter = new CLIConverterAdapter();
    }
}
