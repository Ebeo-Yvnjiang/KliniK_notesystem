"use client";

import { useState } from "react";
import { ContentEditor } from "@/components/content-editor";
import { MarkdownContent } from "@/components/markdown-content";

export function EditableNodeContent({
  target,
  source,
  renderedContent,
  version,
  currentParentId,
  parentOptions,
}: {
  target: { kind: "node"; id: string };
  source: string;
  renderedContent: string;
  version: string;
  currentParentId: string | null;
  parentOptions: {
    node_id: string;
    name: string;
    path: string;
    disabled?: boolean;
    disabledReason?: string;
  }[];
}) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <ContentEditor
        currentParentId={currentParentId}
        initialSource={source}
        initialVersion={version}
        onEditingChange={setEditing}
        parentOptions={parentOptions}
        target={target}
      />
      {!editing && <MarkdownContent content={renderedContent} />}
    </>
  );
}
