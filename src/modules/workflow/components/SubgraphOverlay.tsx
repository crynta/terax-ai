import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  MiniMap,
  Background,
  type Connection,
  type Edge,
  type Node,
  applyEdgeChanges,
  applyNodeChanges,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type {
  WorkflowDocument,
  WorkflowNode,
  WorkflowEdge,
  WorkflowNodeType,
} from "../lib/schema";
import { addWorkflowNode, nextWorkflowNodeId } from "../lib/schema";
import {
  executeWorkflowStep,
  getReadyNodeIds,
  resetWorkflowRuntime,
} from "../lib/execution";
import { toReactFlowElements } from "../lib/reactFlowAdapter";
import { WorkflowNodeCard } from "./WorkflowNodeCard";

const subgraphNodeTypes = { workflowNode: WorkflowNodeCard };

const PALETTE_NODES: { type: WorkflowNodeType; label: string }[] = [
  { type: "textPrompt", label: "Text" },
  { type: "textTransform", label: "Transform" },
  { type: "jsonExtract", label: "JSON Extract" },
  { type: "output", label: "Output" },
  { type: "if", label: "If" },
  { type: "merge", label: "Merge" },
  { type: "delay", label: "Delay" },
  { type: "setVariable", label: "Set Var" },
  { type: "getVariable", label: "Get Var" },
];

/**
 * Overlay for editing a subgraph's inner workflow with full add/connect/run.
 */
export function SubgraphOverlay({
  subgraphNode,
  onUpdateInnerDocument,
  onClose,
}: {
  subgraphNode: WorkflowNode;
  onUpdateInnerDocument: (nodeId: string, innerDoc: WorkflowDocument) => void;
  onClose: () => void;
}) {
  const [doc, setDoc] = useState<WorkflowDocument>(() =>
    resolveInnerDocument(subgraphNode),
  );
  const [title, setTitle] = useState(doc.title);

  const syncToParent = useCallback(
    (updated: WorkflowDocument) => {
      setDoc(updated);
      onUpdateInnerDocument(subgraphNode.id, updated);
    },
    [subgraphNode.id, onUpdateInnerDocument],
  );

  const handleTitleChange = useCallback(
    (newTitle: string) => {
      setTitle(newTitle);
      setDoc((prev) => {
        const updated = { ...prev, title: newTitle };
        onUpdateInnerDocument(subgraphNode.id, updated);
        return updated;
      });
    },
    [subgraphNode.id, onUpdateInnerDocument],
  );

  const handleAddNode = useCallback(
    (type: WorkflowNodeType) => {
      setDoc((prev) => {
        const id = nextWorkflowNodeId(prev, type);
        const updated = addWorkflowNode(prev, {
          id,
          type,
          position: {
            x: 200 + Math.random() * 200,
            y: 100 + Math.random() * 200,
          },
        });
        onUpdateInnerDocument(subgraphNode.id, updated);
        return updated;
      });
    },
    [subgraphNode.id, onUpdateInnerDocument],
  );

  const handleRunStep = useCallback(() => {
    setDoc((prev) => {
      let current = resetWorkflowRuntime(prev);
      if (getReadyNodeIds(current).length === 0) return prev;
      current = executeWorkflowStep(current);
      onUpdateInnerDocument(subgraphNode.id, current);
      return current;
    });
  }, [subgraphNode.id, onUpdateInnerDocument]);

  const handleRunAll = useCallback(() => {
    setDoc((prev) => {
      let current = resetWorkflowRuntime(prev);
      const maxSteps = Math.max(current.nodes.length * 2, 1);
      for (let i = 0; i < maxSteps; i++) {
        if (getReadyNodeIds(current).length === 0) break;
        current = executeWorkflowStep(current);
      }
      onUpdateInnerDocument(subgraphNode.id, current);
      return current;
    });
  }, [subgraphNode.id, onUpdateInnerDocument]);

  const handleReset = useCallback(() => {
    setDoc((prev) => {
      const updated = resetWorkflowRuntime(prev);
      onUpdateInnerDocument(subgraphNode.id, updated);
      return updated;
    });
  }, [subgraphNode.id, onUpdateInnerDocument]);

  const completedCount = doc.nodes.filter(
    (n) => n.runtimeState.status === "completed",
  ).length;
  const failedCount = doc.nodes.filter(
    (n) => n.runtimeState.status === "failed",
  ).length;

  return (
    <div className="absolute inset-0 z-[90] flex flex-col bg-background rounded-lg border border-border shadow-2xl">
      {/* Header bar */}
      <div className="flex shrink-0 items-center justify-between border-border/40 border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={onClose}
          >
            ← Back
          </Button>
          <div className="h-4 w-px bg-border" />
          <input
            type="text"
            className="bg-transparent font-medium text-sm outline-none border-b border-transparent hover:border-border focus:border-primary px-1"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Subgraph title"
          />
          <span className="text-muted-foreground text-[10px]">
            {doc.nodes.length} nodes · {doc.edges.length} edges
          </span>
          {completedCount > 0 && (
            <Badge variant="default" className="text-[9px]">
              {completedCount} done
            </Badge>
          )}
          {failedCount > 0 && (
            <Badge variant="destructive" className="text-[9px]">
              {failedCount} failed
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Node palette */}
          {PALETTE_NODES.map((n) => (
            <Button
              key={n.type}
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px]"
              onClick={() => handleAddNode(n.type)}
            >
              + {n.label}
            </Button>
          ))}
          <div className="h-4 w-px bg-border mx-1" />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[10px]"
            onClick={handleRunStep}
          >
            Step
          </Button>
          <Button
            type="button"
            size="sm"
            variant="default"
            className="h-6 px-2 text-[10px]"
            onClick={handleRunAll}
          >
            Run all
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10px]"
            onClick={handleReset}
          >
            Reset
          </Button>
        </div>
      </div>

      {/* Nested canvas */}
      <div className="flex-1">
        <ReactFlowProvider>
          <SubgraphCanvas doc={doc} onChange={syncToParent} />
        </ReactFlowProvider>
      </div>
    </div>
  );
}

/**
 * Nested React Flow canvas with full node/edge state management.
 */
function SubgraphCanvas({
  doc,
  onChange,
}: {
  doc: WorkflowDocument;
  onChange: (doc: WorkflowDocument) => void;
}) {
  const elements = useMemo(() => toReactFlowElements(doc), [doc]);

  const rfNodes: Node[] = useMemo(
    () =>
      elements.nodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          node: doc.nodes.find((dn) => dn.id === n.id),
          document: doc,
          // Provide minimal stubs for WorkflowNodeData callbacks
          visible: true,
          workflowId: doc.id,
          artifacts: [],
          discoveredProviderModels: {},
          reusableArtifacts: [],
          pendingConnection: null,
          workflowDocumentId: doc.id,
          onApproveNode: () => {},
          onArtifactActionError: () => {},
          onArtifactMaterialized: () => {},
          onRejectNode: () => {},
          onDeleteArtifact: () => {},
          onDeleteNode: () => {},
          onDuplicateNode: () => {},
          onRenameNode: () => {},
          onTogglePin: () => {},
          onHandleClick: () => {},
          onHandleMouseDown: () => {},
          onPreviewArtifact: () => {},
          onUpdateNodeConfig: () => {},
        },
      })),
    [elements.nodes, doc],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      elements.edges.map((e) => ({
        ...e,
        animated: true,
      })),
    [elements.edges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const updated = applyNodeChanges(changes, rfNodes);
      // Extract positions back to document
      const positionMap = new Map(updated.map((n) => [n.id, n.position]));
      const newDoc = {
        ...doc,
        nodes: doc.nodes.map((n) => {
          const pos = positionMap.get(n.id);
          return pos ? { ...n, position: { x: pos.x, y: pos.y } } : n;
        }),
      };
      onChange(newDoc);
    },
    [doc, rfNodes, onChange],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const updated = applyEdgeChanges(changes, rfEdges);
      const edgeIds = new Set(updated.map((e) => e.id));
      const newDoc = {
        ...doc,
        edges: doc.edges.filter((e) => edgeIds.has(e.id)),
      };
      onChange(newDoc);
    },
    [doc, rfEdges, onChange],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const id = `e-${connection.source}-${connection.sourceHandle || "out"}-${connection.target}-${connection.targetHandle || "in"}`;
      const newEdge: WorkflowEdge = {
        id,
        sourceNodeId: connection.source!,
        sourcePortId: connection.sourceHandle!,
        targetNodeId: connection.target!,
        targetPortId: connection.targetHandle!,
      };
      onChange({ ...doc, edges: [...doc.edges, newEdge] });
    },
    [doc, onChange],
  );

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={subgraphNodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      fitView
      snapToGrid
      snapGrid={[20, 20]}
      className="bg-muted/5"
    >
      <Controls />
      <MiniMap />
      <Background />
    </ReactFlow>
  );
}

function resolveInnerDocument(node: WorkflowNode): WorkflowDocument {
  const inner = node.config.innerDocument;
  if (
    inner !== null &&
    inner !== undefined &&
    typeof inner === "object" &&
    !Array.isArray(inner) &&
    "nodes" in inner
  ) {
    return inner as WorkflowDocument;
  }
  return {
    id: `subgraph-${Date.now()}`,
    title: "Subgraph",
    version: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    variables: [],
    artifacts: [],
    nodes: [],
    edges: [],
  };
}
