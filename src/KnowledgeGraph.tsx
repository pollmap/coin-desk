import { useMemo } from 'react';
import { ReactFlow, Controls, Position, type Node, type Edge } from '@xyflow/react';
import type { KnowledgeResponse } from '../shared/knowledge';
import '@xyflow/react/dist/style.css';
export default function KnowledgeGraph({
  data,
  selected,
  onSelect,
}: {
  data: KnowledgeResponse;
  selected?: string;
  onSelect: (id: string) => void;
}) {
  const nodes = useMemo<Node[]>(
    () =>
      data.nodes.slice(0, 12).map((n, i) => ({
        id: n.id,
        position:
          i === 0 ? { x: 0, y: 180 } : { x: 360 + (i > 5 ? 340 : 0), y: ((i - 1) % 5) * 100 },
        data: { label: n.label },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        selected: n.id === selected,
        draggable: false,
        ariaLabel: n.label + ' 관계 근거',
        style: {
          background: 'var(--panel)',
          color: 'var(--text)',
          borderColor: n.id === selected ? 'var(--accent)' : 'var(--border)',
          width: 180,
        },
      })),
    [data, selected],
  );
  const edges = useMemo<Edge[]>(
    () =>
      data.edges.map((e) => ({
        ...e,
        type: 'smoothstep',
        animated: false,
        labelStyle: { fill: 'var(--text)', fontSize: 12 },
        labelBgStyle: { fill: 'var(--panel)' },
        focusable: false,
      })),
    [data],
  );
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      fitView
      nodesConnectable={false}
      nodesDraggable={false}
      onNodeClick={(_, n) => onSelect(n.id)}
      onNodesChange={(changes) => {
        const pick = changes.find((c) => c.type === 'select' && c.selected);
        if (pick?.type === 'select') onSelect(pick.id);
      }}
      minZoom={0.4}
      maxZoom={1.5}
      panOnScroll={false}
      zoomOnScroll={false}
      ariaLabelConfig={{
        'controls.zoomIn.ariaLabel': '관계 지도 확대',
        'controls.zoomOut.ariaLabel': '관계 지도 축소',
        'controls.fitView.ariaLabel': '관계 지도 전체 보기',
      }}
    >
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
