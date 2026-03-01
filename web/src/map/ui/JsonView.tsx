import { prettyJson } from "../../utils/pretty";

export function JsonView({ value }: { value: unknown }) {
  return <pre className="json-view">{prettyJson(value)}</pre>;
}
