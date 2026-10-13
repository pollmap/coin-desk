import { WorkspaceBar, usePersonalDesk } from './PersonalDesk';
import { chartSettings } from '../shared/workspace';
import { saved } from './lib';

export default function SavedPage() {
  const preferences = chartSettings(saved('preferences', {}));
  const { desk } = usePersonalDesk();
  return (
    <>
      <div className="page-heading">
        <h1>내 저장</h1>
      </div>
      <section className="workspace-page">
        <WorkspaceBar listOnly current={{ ...preferences, cards: desk.cards, view: 'chart' }} />
      </section>
    </>
  );
}
