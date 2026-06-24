import { ProjectPicker } from 'kitstak-ui';

export function Closed() {
  return (
    <ProjectPicker
      value=""
      onChange={() => {}}
      label="Project"
      placeholder="Search projects"
    />
  );
}
