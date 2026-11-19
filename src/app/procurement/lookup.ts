// Project name, code and sample company for the procurement prototype pages.
import { SAMPLE_PROJECTS } from '../sample/projects';
import { SAMPLE_PROJECT_DETAILS } from '../sample/project-details';

export const projectOf = (id: string) => {
    const p = SAMPLE_PROJECTS.find((x) => x.id === id)!;
    return { code: p.code, name: p.name, company: SAMPLE_PROJECT_DETAILS[id].company };
};
