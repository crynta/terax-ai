import type { Output } from "./lib/notebook";

type Props = {
  output: Output;
};

const monoTextClass = "whitespace-pre-wrap font-mono text-[13px]";

function asText(value: string | string[] | undefined): string {
  if (!value) return "";
  return Array.isArray(value) ? value.join("") : value;
}

function imageDataUrl(
  mimeType: "image/png" | "image/jpeg",
  data: string | string[]
) {
  return `data:${mimeType};base64,${asText(data).replace(/\n/g, "")}`;
}

function PlainText({
  children,
  error = false,
}: {
  children: string;
  error?: boolean;
}) {
  return (
    <pre
      className={`${monoTextClass} ${
        error ? "text-destructive" : "text-foreground/80"
      }`}
    >
      {children}
    </pre>
  );
}

export function NotebookOutput({ output }: Props) {
  if (output.output_type === "stream") {
    return (
      <PlainText error={output.name === "stderr"}>
        {asText(output.text)}
      </PlainText>
    );
  }

  if (output.output_type === "error") {
    const trace = output.traceback ? output.traceback.join("\n") : "";
    return (
      <PlainText error>
        {trace || `${output.ename}: ${output.evalue}`}
      </PlainText>
    );
  }

  if (
    output.output_type === "display_data" ||
    output.output_type === "execute_result"
  ) {
    const data = output.data;
    if (!data) return null;

    if (data["image/png"]) {
      return (
        <img
          src={imageDataUrl("image/png", data["image/png"])}
          alt="cell output"
          className="max-w-full h-auto bg-white"
        />
      );
    }
    if (data["image/jpeg"]) {
      return (
        <img
          src={imageDataUrl("image/jpeg", data["image/jpeg"])}
          alt="cell output"
          className="max-w-full h-auto bg-white"
        />
      );
    }
    if (data["text/html"]) {
      return (
        <div
          dangerouslySetInnerHTML={{ __html: asText(data["text/html"]) }}
          className="prose prose-sm dark:prose-invert max-w-none"
        />
      );
    }
    if (data["application/json"]) {
      return (
        <PlainText>{JSON.stringify(data["application/json"], null, 2)}</PlainText>
      );
    }
    if (data["text/plain"]) {
      return <PlainText>{asText(data["text/plain"])}</PlainText>;
    }
  }

  return null;
}
