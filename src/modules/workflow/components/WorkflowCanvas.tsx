import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  type Connection,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  type EdgeChange,
  MiniMap,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  collectReusableWorkflowArtifacts,
  persistWorkflowArtifactBinaryFile,
  removeWorkflowArtifact,
  workflowArtifactStorageDirectory,
} from "../lib/artifactStorage";
import {
  approveWorkflowNode,
  getReadyNodeIds,
  rejectWorkflowNode,
  resetWorkflowRuntime,
  startApprovedWorkflowNodeExecution,
  startWorkflowStepExecution,
  type WorkflowAgentExecutor,
  type WorkflowBrowserAutomationExecutor,
  type WorkflowFileOperationExecutor,
  type WorkflowHttpRequestExecutor,
  type WorkflowShellCommandExecutor,
} from "../lib/execution";
import { type WorkflowRecentFile } from "../lib/filePersistence";
import { workflowNativeHttpExecutor } from "../lib/httpExecution";
import { buildWorkflowInspectorState } from "../lib/inspector";
import { tauriWorkflowPiAgentExecutor } from "../lib/nativeAgentExecution";
import { tauriWorkflowArtifactFileSystem } from "../lib/nativeArtifactStorage";
import { tauriWorkflowBrowserAutomationExecutor } from "../lib/nativeBrowserAutomation";
import { tauriWorkflowFileOperationExecutor } from "../lib/nativeFileExecution";
import { tauriWorkflowShellExecutor } from "../lib/nativeShellExecution";
import type { WorkflowDiscoveredProviderModels } from "../lib/providerConfigUi";
import {
  canConnectReactFlowEdge,
  reactFlowEdgeId,
  toReactFlowElements,
  updateWorkflowDocumentFromReactFlow,
} from "../lib/reactFlowAdapter";
import {
  addWorkflowNode,
  clearWorkflowCanvas,
  duplicateWorkflowNode,
  nextWorkflowNodeId,
  removeWorkflowNode,
  updateWorkflowNodeConfig,
  type WorkflowArtifact,
  type WorkflowDocument,
  type WorkflowNodeType,
} from "../lib/schema";
import {
  decorateWorkflowEdge,
  normalizeWorkflowFlowEdge,
  workflowConnectionLineStyle,
  workflowDefaultEdgeOptions,
  workflowEdgeFromConnection,
} from "./WorkflowCanvasEdges";
import {
  approvedRunLabel,
  artifactActionErrorMessage,
  artifactsForFlowNode,
  hasRuntimeStatus,
  isApprovedRuntimeNode,
  isWorkflowEditableKeyTarget,
  nextNodePosition,
  oppositeHandleLabel,
  replaceWorkflowArtifact,
  sameWorkflowHandle,
  WorkflowDragConnectionLine,
  WorkflowFallbackEdgeLayer,
  workflowConnectionHandleFromPoint,
  workflowHandleText,
  WorkflowInspectorPanel,
  WorkflowNodeCard,
} from "./WorkflowCanvasParts";
import { WorkflowCanvasPanels } from "./WorkflowCanvasPanels";
import { useWorkflowFileActions } from "./useWorkflowFileActions";
import type {
  WorkflowConnectionDragState,
  WorkflowConnectionHandle,
  WorkflowFlowEdge,
  WorkflowFlowNode,
} from "./WorkflowCanvasTypes";

export type WorkflowRuntimeExecutors = {
  executeAgent?: WorkflowAgentExecutor;
  executeBrowserAutomation?: WorkflowBrowserAutomationExecutor;
  executeFileOperation?: WorkflowFileOperationExecutor;
  executeHttpRequest?: WorkflowHttpRequestExecutor;
  executeShellCommand?: WorkflowShellCommandExecutor;
};

type Props = {
  document: WorkflowDocument;
  visible: boolean;
  filePath?: string;
  dirty?: boolean;
  onDocumentChange?: (document: WorkflowDocument) => void;
  onSaveDocument?: (document: WorkflowDocument) => Promise<void>;
  onSaveAsDocument?: (
    document: WorkflowDocument,
    path: string,
  ) => Promise<void>;
  recentWorkflowFiles?: WorkflowRecentFile[];
  onOpenWorkflowPath?: (path: string) => void;
  runtimeExecutors?: WorkflowRuntimeExecutors;
  discoveredProviderModels?: WorkflowDiscoveredProviderModels;
};

const nodeTypes = {
  workflowNode: WorkflowNodeCard,
};

const emptyDiscoveredProviderModels: WorkflowDiscoveredProviderModels = {};

export function WorkflowCanvas({
  document,
  visible,
  filePath,
  dirty = false,
  onDocumentChange,
  onSaveDocument,
  onSaveAsDocument,
  recentWorkflowFiles = [],
  onOpenWorkflowPath,
  runtimeExecutors,
  discoveredProviderModels = emptyDiscoveredProviderModels,
}: Props) {
  const flow = useMemo(() => toReactFlowElements(document), [document]);
  const [workflowIoMessage, setWorkflowIoMessage] = useState<string | null>(
    null,
  );
  const [savingFile, setSavingFile] = useState(false);
  const [workflowRunning, setWorkflowRunning] = useState(false);
  const [pendingConnection, setPendingConnection] =
    useState<WorkflowConnectionHandle | null>(null);
  const [dragConnection, setDragConnection] =
    useState<WorkflowConnectionDragState | null>(null);
  const canvasRootRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const runAbortControllerRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const handleApproveNode = useCallback(
    (nodeId: string) => {
      const target = document.nodes.find((node) => node.id === nodeId);
      if (!target || !isApprovedRuntimeNode(target)) {
        onDocumentChange?.(approveWorkflowNode(document, nodeId));
        return;
      }

      runAbortControllerRef.current?.abort();
      const controller = new AbortController();
      const runId = runIdRef.current + 1;
      runIdRef.current = runId;
      runAbortControllerRef.current = controller;
      setWorkflowRunning(true);

      const execution = startApprovedWorkflowNodeExecution(document, nodeId, {
        ...(target.type === "agent"
          ? {
              executeAgent:
                runtimeExecutors?.executeAgent ?? tauriWorkflowPiAgentExecutor,
            }
          : {}),
        ...(target.type === "browserAutomation"
          ? {
              executeBrowserAutomation:
                runtimeExecutors?.executeBrowserAutomation ??
                tauriWorkflowBrowserAutomationExecutor,
            }
          : {}),
        ...(target.type === "fileOperation"
          ? {
              executeFileOperation:
                runtimeExecutors?.executeFileOperation ??
                tauriWorkflowFileOperationExecutor,
            }
          : {}),
        ...(target.type === "shellCommand"
          ? {
              executeShellCommand:
                runtimeExecutors?.executeShellCommand ??
                tauriWorkflowShellExecutor,
            }
          : {}),
        onProgress: (progressDocument) => {
          if (runIdRef.current === runId) onDocumentChange?.(progressDocument);
        },
        persistArtifact: filePath
          ? (artifact, progressDocument) =>
              persistWorkflowArtifactBinaryFile(artifact, {
                baseDirectory: workflowArtifactStorageDirectory({
                  workflowFilePath: filePath,
                  documentId: progressDocument.id,
                }),
                fileSystem: tauriWorkflowArtifactFileSystem,
              })
          : undefined,
        signal: controller.signal,
      });
      onDocumentChange?.(execution.document);
      void execution.finished
        .then((finished) => {
          if (runIdRef.current !== runId) return;
          onDocumentChange?.(finished);
          const label = approvedRunLabel(target);
          if (hasRuntimeStatus(finished, "cancelled")) {
            setWorkflowIoMessage(`${label} cancelled`);
          } else if (hasRuntimeStatus(finished, "failed")) {
            setWorkflowIoMessage(`${label} failed`);
          }
        })
        .finally(() => {
          if (runIdRef.current !== runId) return;
          runAbortControllerRef.current = null;
          setWorkflowRunning(false);
        });
    },
    [document, filePath, onDocumentChange, runtimeExecutors],
  );
  const handleRejectNode = useCallback(
    (nodeId: string) => {
      onDocumentChange?.(rejectWorkflowNode(document, nodeId));
    },
    [document, onDocumentChange],
  );
  const handleUpdateNodeConfig = useCallback(
    (nodeId: string, patch: Record<string, unknown>) => {
      onDocumentChange?.(updateWorkflowNodeConfig(document, nodeId, patch));
    },
    [document, onDocumentChange],
  );
  const handleDuplicateNode = useCallback(
    (nodeId: string) => {
      onDocumentChange?.(duplicateWorkflowNode(document, nodeId));
    },
    [document, onDocumentChange],
  );
  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      const node = document.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return;
      if (!onDocumentChange) {
        setWorkflowIoMessage("Delete unavailable for this workflow view");
        return;
      }

      setPendingConnection(null);
      setDragConnection(null);
      setSelectedNodeId(null);
      setPreviewArtifactId(null);
      onDocumentChange(removeWorkflowNode(document, nodeId));
      setWorkflowIoMessage(`Deleted ${node.title}`);
    },
    [document, onDocumentChange],
  );
  const handleDeleteArtifact = useCallback(
    (artifactId: string) => {
      onDocumentChange?.(removeWorkflowArtifact(document, artifactId));
    },
    [document, onDocumentChange],
  );
  const handlePreviewArtifact = useCallback((artifact: WorkflowArtifact) => {
    setPreviewArtifactId(artifact.id);
  }, []);
  const handleArtifactActionError = useCallback((error: unknown) => {
    setWorkflowIoMessage(artifactActionErrorMessage(error));
  }, []);
  const handleArtifactMaterialized = useCallback(
    (artifact: WorkflowArtifact) => {
      if (!onDocumentChange) return;
      onDocumentChange(replaceWorkflowArtifact(document, artifact));
      setWorkflowIoMessage(
        `Artifact saved: ${artifact.storage?.path ?? artifact.label}`,
      );
    },
    [document, onDocumentChange],
  );
  const connectWorkflowHandles = useCallback(
    (first: WorkflowConnectionHandle, second: WorkflowConnectionHandle) => {
      const source = first.direction === "source" ? first : second;
      const target = first.direction === "target" ? first : second;
      const edge = normalizeWorkflowFlowEdge(document, {
        id: reactFlowEdgeId({
          source: source.nodeId,
          sourceHandle: source.portId,
          target: target.nodeId,
          targetHandle: target.portId,
        }),
        source: source.nodeId,
        sourceHandle: source.portId,
        target: target.nodeId,
        targetHandle: target.portId,
      });

      setPendingConnection(null);
      if (!edge) {
        setWorkflowIoMessage(
          `Cannot connect ${source.portType} output to ${target.portType} input`,
        );
        return false;
      }
      if (!onDocumentChange) {
        setWorkflowIoMessage("Connection unavailable for this workflow view");
        return false;
      }

      const nextEdges = addEdge(edge, flow.edges.map(decorateWorkflowEdge));
      onDocumentChange(
        updateWorkflowDocumentFromReactFlow(document, {
          nodes: flow.nodes,
          edges: nextEdges,
        }),
      );
      setWorkflowIoMessage(
        `Connected ${source.nodeTitle} to ${target.nodeTitle}`,
      );
      return true;
    },
    [document, flow.edges, flow.nodes, onDocumentChange],
  );
  const handleWorkflowHandleClick = useCallback(
    (handle: WorkflowConnectionHandle) => {
      if (
        !pendingConnection ||
        pendingConnection.direction === handle.direction
      ) {
        setPendingConnection(handle);
        setWorkflowIoMessage(
          `${workflowHandleText(handle)} selected; click a ${oppositeHandleLabel(handle.direction)}.`,
        );
        return;
      }

      connectWorkflowHandles(pendingConnection, handle);
    },
    [connectWorkflowHandles, pendingConnection],
  );
  const handleWorkflowHandleMouseDown = useCallback(
    (handle: WorkflowConnectionHandle, event: ReactMouseEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const center = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
      setDragConnection({
        handle,
        fromClient: center,
        toClient: { x: event.clientX, y: event.clientY },
      });
    },
    [],
  );
  const initialNodes = useMemo<WorkflowFlowNode[]>(
    () =>
      flow.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          visible,
          workflowId: document.id,
          artifacts: artifactsForFlowNode(document, node.data.node),
          discoveredProviderModels,
          reusableArtifacts: collectReusableWorkflowArtifacts(
            document,
            node.data.node,
          ),
          pendingConnection,
          onApproveNode: handleApproveNode,
          onArtifactActionError: handleArtifactActionError,
          onArtifactMaterialized: handleArtifactMaterialized,
          onRejectNode: handleRejectNode,
          onDeleteArtifact: handleDeleteArtifact,
          onDeleteNode: handleDeleteNode,
          onDuplicateNode: handleDuplicateNode,
          onHandleClick: handleWorkflowHandleClick,
          onHandleMouseDown: handleWorkflowHandleMouseDown,
          onPreviewArtifact: handlePreviewArtifact,
          workflowFilePath: filePath,
          workflowDocumentId: document.id,
          onUpdateNodeConfig: handleUpdateNodeConfig,
        },
      })),
    [
      flow.nodes,
      visible,
      discoveredProviderModels,
      document,
      document.id,
      handleApproveNode,
      handleArtifactActionError,
      handleArtifactMaterialized,
      handleRejectNode,
      handleDeleteArtifact,
      handleDeleteNode,
      handleDuplicateNode,
      handleWorkflowHandleClick,
      handleWorkflowHandleMouseDown,
      handlePreviewArtifact,
      filePath,
      pendingConnection,
      handleUpdateNodeConfig,
    ],
  );
  const initialEdges = useMemo<WorkflowFlowEdge[]>(
    () => flow.edges.map(decorateWorkflowEdge),
    [flow.edges],
  );
  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [previewArtifactId, setPreviewArtifactId] = useState<string | null>(
    null,
  );
  const readyNodeIds = useMemo(() => getReadyNodeIds(document), [document]);
  const previewArtifact = useMemo(
    () =>
      previewArtifactId
        ? (document.artifacts.find(
            (artifact) => artifact.id === previewArtifactId,
          ) ?? null)
        : null,
    [document.artifacts, previewArtifactId],
  );
  const inspectorState = useMemo(
    () => buildWorkflowInspectorState(document, { selectedNodeId }),
    [document, selectedNodeId],
  );
  const handleDeleteSelectedNode = useCallback(() => {
    if (selectedNodeId) handleDeleteNode(selectedNodeId);
  }, [handleDeleteNode, selectedNodeId]);
  const handleClearCanvas = useCallback(() => {
    if (document.nodes.length === 0) {
      setWorkflowIoMessage("Canvas is already empty");
      return;
    }
    if (!onDocumentChange) {
      setWorkflowIoMessage("Clear unavailable for this workflow view");
      return;
    }
    if (!window.confirm("Clear all workflow nodes, edges, and artifacts?")) {
      return;
    }

    setPendingConnection(null);
    setDragConnection(null);
    setSelectedNodeId(null);
    setPreviewArtifactId(null);
    onDocumentChange(clearWorkflowCanvas(document));
    setWorkflowIoMessage("Canvas cleared");
  }, [document, onDocumentChange]);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);
  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);
  useEffect(() => {
    if (
      selectedNodeId &&
      !document.nodes.some((node) => node.id === selectedNodeId)
    ) {
      setSelectedNodeId(null);
    }
  }, [document.nodes, selectedNodeId]);
  useEffect(() => {
    if (
      previewArtifactId &&
      !document.artifacts.some((artifact) => artifact.id === previewArtifactId)
    ) {
      setPreviewArtifactId(null);
    }
  }, [document.artifacts, previewArtifactId]);
  useEffect(() => {
    if (!visible || !selectedNodeId) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        (event.key !== "Delete" && event.key !== "Backspace") ||
        isWorkflowEditableKeyTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      handleDeleteNode(selectedNodeId);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDeleteNode, selectedNodeId, visible]);
  useEffect(
    () => () => {
      runAbortControllerRef.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!dragConnection) return;

    const handleMouseMove = (event: MouseEvent) => {
      setDragConnection((current) =>
        current
          ? { ...current, toClient: { x: event.clientX, y: event.clientY } }
          : current,
      );
    };
    const handleMouseUp = (event: MouseEvent) => {
      const target = workflowConnectionHandleFromPoint(
        document,
        event.clientX,
        event.clientY,
      );
      if (target && !sameWorkflowHandle(dragConnection.handle, target)) {
        connectWorkflowHandles(dragConnection.handle, target);
      }
      setDragConnection(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp, { once: true });
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [connectWorkflowHandles, document, dragConnection]);

  const persistFlow = useCallback(
    (
      nextNodes: WorkflowFlowNode[],
      nextEdges: WorkflowFlowEdge[],
      viewport?: Viewport,
    ) => {
      onDocumentChange?.(
        updateWorkflowDocumentFromReactFlow(document, {
          nodes: nextNodes,
          edges: nextEdges,
          viewport,
        }),
      );
    },
    [document, onDocumentChange],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<WorkflowFlowNode>[]) => {
      const nextNodes = applyNodeChanges(changes, nodes);
      setNodes(nextNodes);
      persistFlow(nextNodes, edges);
    },
    [edges, nodes, persistFlow],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<WorkflowFlowEdge>[]) => {
      const nextEdges = applyEdgeChanges(changes, edges);
      setEdges(nextEdges);
      persistFlow(nodes, nextEdges);
    },
    [edges, nodes, persistFlow],
  );

  const isCurrentWorkflowRun = useCallback(
    (runId: number) => runIdRef.current === runId,
    [],
  );

  const beginWorkflowRun = useCallback(() => {
    runAbortControllerRef.current?.abort();
    const controller = new AbortController();
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    runAbortControllerRef.current = controller;
    setWorkflowRunning(true);
    return { controller, runId };
  }, []);

  const finishWorkflowRun = useCallback(
    (runId: number) => {
      if (!isCurrentWorkflowRun(runId)) return;
      runAbortControllerRef.current = null;
      setWorkflowRunning(false);
    },
    [isCurrentWorkflowRun],
  );

  const runOneAsyncStep = useCallback(
    async (
      current: WorkflowDocument,
      signal: AbortSignal,
      runId: number,
    ): Promise<WorkflowDocument> => {
      const execution = startWorkflowStepExecution(current, {
        executeHttpRequest:
          runtimeExecutors?.executeHttpRequest ?? workflowNativeHttpExecutor,
        onProgress: (progressDocument) => {
          if (isCurrentWorkflowRun(runId)) onDocumentChange?.(progressDocument);
        },
        persistArtifact: filePath
          ? (artifact, progressDocument) =>
              persistWorkflowArtifactBinaryFile(artifact, {
                baseDirectory: workflowArtifactStorageDirectory({
                  workflowFilePath: filePath,
                  documentId: progressDocument.id,
                }),
                fileSystem: tauriWorkflowArtifactFileSystem,
              })
          : undefined,
        signal,
      });
      if (isCurrentWorkflowRun(runId)) onDocumentChange?.(execution.document);
      const finished = await execution.finished;
      if (isCurrentWorkflowRun(runId)) onDocumentChange?.(finished);
      return finished;
    },
    [filePath, isCurrentWorkflowRun, onDocumentChange, runtimeExecutors],
  );

  const handleCancelRun = useCallback(() => {
    runAbortControllerRef.current?.abort();
    setWorkflowIoMessage("Cancelling workflow run");
  }, []);

  const handleRunStep = useCallback(async () => {
    const { controller, runId } = beginWorkflowRun();
    try {
      const finished = await runOneAsyncStep(
        document,
        controller.signal,
        runId,
      );
      if (!isCurrentWorkflowRun(runId)) return;
      if (hasRuntimeStatus(finished, "cancelled")) {
        setWorkflowIoMessage("Step cancelled");
      } else if (hasRuntimeStatus(finished, "failed")) {
        setWorkflowIoMessage("Step finished with a failed node");
      }
    } finally {
      finishWorkflowRun(runId);
    }
  }, [
    beginWorkflowRun,
    document,
    finishWorkflowRun,
    isCurrentWorkflowRun,
    runOneAsyncStep,
  ]);

  const handleRunUntilBlocked = useCallback(async () => {
    const { controller, runId } = beginWorkflowRun();
    try {
      let current = document;
      const maxSteps = Math.max(current.nodes.length * 2, 1);
      for (let step = 0; step < maxSteps; step += 1) {
        if (getReadyNodeIds(current).length === 0) break;
        current = await runOneAsyncStep(current, controller.signal, runId);
        if (!isCurrentWorkflowRun(runId)) return;
        if (hasRuntimeStatus(current, "cancelled")) {
          setWorkflowIoMessage("Run cancelled");
          break;
        }
        if (hasRuntimeStatus(current, "failed")) {
          setWorkflowIoMessage("Run stopped with a failed node");
          break;
        }
      }
    } finally {
      finishWorkflowRun(runId);
    }
  }, [
    beginWorkflowRun,
    document,
    finishWorkflowRun,
    isCurrentWorkflowRun,
    runOneAsyncStep,
  ]);

  const handleResetRuntime = useCallback(() => {
    onDocumentChange?.(resetWorkflowRuntime(document));
  }, [document, onDocumentChange]);

  const handleAddNode = useCallback(
    (type: WorkflowNodeType) => {
      onDocumentChange?.(
        addWorkflowNode(document, {
          id: nextWorkflowNodeId(document, type),
          type,
          position: nextNodePosition(document),
        }),
      );
    },
    [document, onDocumentChange],
  );

  const handleMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      persistFlow(nodes, edges, viewport);
    },
    [edges, nodes, persistFlow],
  );

  const {
    handleCopyJson,
    handleDownloadJson,
    handleImportJsonChange,
    handleOpenWorkflowFile,
    handleSaveAsFile,
    handleSaveFile,
  } = useWorkflowFileActions({
    document,
    filePath,
    importInputRef,
    onDocumentChange,
    onOpenWorkflowPath,
    onSaveAsDocument,
    onSaveDocument,
    setSavingFile,
    setWorkflowIoMessage,
  });

  const isValidWorkflowConnection = useCallback(
    (connection: Connection | WorkflowFlowEdge) => {
      const edge = workflowEdgeFromConnection(connection);
      return edge ? canConnectReactFlowEdge(document, edge) : false;
    },
    [document],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      const rawEdge = workflowEdgeFromConnection(connection);
      const edge = rawEdge
        ? normalizeWorkflowFlowEdge(document, rawEdge)
        : null;
      if (!edge) {
        setWorkflowIoMessage("Cannot connect incompatible workflow handles");
        return;
      }

      setEdges((currentEdges) => {
        const nextEdges = addEdge(edge, currentEdges);
        persistFlow(nodes, nextEdges);
        return nextEdges;
      });
      setWorkflowIoMessage("Connected workflow nodes");
    },
    [document, nodes, persistFlow],
  );

  return (
    <ReactFlowProvider>
      <div ref={canvasRootRef} className="relative h-full w-full">
        <div className="sr-only">Workflow canvas ready</div>
        <WorkflowFallbackEdgeLayer document={document} />
        <WorkflowDragConnectionLine
          dragConnection={dragConnection}
          rootRef={canvasRootRef}
        />
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onMoveEnd={handleMoveEnd}
          isValidConnection={isValidWorkflowConnection}
          defaultEdgeOptions={workflowDefaultEdgeOptions}
          connectionMode={ConnectionMode.Loose}
          connectionLineStyle={workflowConnectionLineStyle}
          connectionLineType={ConnectionLineType.SmoothStep}
          connectionRadius={48}
          connectionDragThreshold={0}
          nodesConnectable
          onNodeClick={(_event, node) =>
            setSelectedNodeId(node.data.workflowNodeId)
          }
          onPaneClick={() => setSelectedNodeId(null)}
          defaultViewport={document.viewport}
          minZoom={0.15}
          maxZoom={1.8}
          proOptions={{ hideAttribution: true }}
          className="bg-background"
        >
          <WorkflowCanvasPanels
            dirty={dirty}
            document={document}
            filePath={filePath}
            importInputRef={importInputRef}
            previewArtifact={previewArtifact}
            readyNodeCount={readyNodeIds.length}
            recentWorkflowFiles={recentWorkflowFiles}
            savingFile={savingFile}
            selectedNodeId={selectedNodeId}
            workflowIoMessage={workflowIoMessage}
            workflowRunning={workflowRunning}
            onAddNode={handleAddNode}
            onArtifactActionError={handleArtifactActionError}
            onArtifactMaterialized={handleArtifactMaterialized}
            onCancelRun={handleCancelRun}
            onClearCanvas={handleClearCanvas}
            onClosePreview={() => setPreviewArtifactId(null)}
            onCopyJson={handleCopyJson}
            onDeleteArtifact={handleDeleteArtifact}
            onDeleteSelectedNode={handleDeleteSelectedNode}
            onDownloadJson={handleDownloadJson}
            onImportJsonChange={handleImportJsonChange}
            onOpenWorkflowFile={handleOpenWorkflowFile}
            onOpenWorkflowPath={onOpenWorkflowPath}
            onPreviewArtifact={handlePreviewArtifact}
            onResetRuntime={handleResetRuntime}
            onRunStep={() => void handleRunStep()}
            onRunUntilBlocked={() => void handleRunUntilBlocked()}
            onSaveAsFile={() => void handleSaveAsFile()}
            onSaveAsUnavailable={!onSaveAsDocument}
            onSaveFile={() => void handleSaveFile()}
          />
          <WorkflowInspectorPanel state={inspectorState} />
          <Background gap={28} size={1} className="opacity-40" />
          <MiniMap
            pannable
            zoomable
            className="overflow-hidden rounded-md border border-border/60 bg-card/90"
          />
          <Controls className="overflow-hidden rounded-md border border-border/60 bg-card/90 text-foreground" />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}
