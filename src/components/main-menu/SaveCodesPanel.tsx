import type { SaveSystemStatus } from '../../settings/useSaveAccountSync';
interface SaveCodesPanelProps {
  saveSystemStatus: SaveSystemStatus; saveCodeImportInput: string;
  onExportSaveCode: () => void; onResetAllSettings: () => void;
  onSaveCodeImportInputChange: (value:string) => void; onImportSaveCode: (value:string) => void;
}
export function SaveCodesPanel(props: SaveCodesPanelProps) {
  return <div className="menu-save-data">
    {props.saveSystemStatus.type && <p role="status" className={props.saveSystemStatus.type==='error'?'menu-error':'menu-success'}>{props.saveSystemStatus.message}</p>}
    <div className="menu-save-row"><div><h3>Export save code</h3><p>Back up your settings, controls, appearance, custom armor, and HUD layouts.</p></div><button className="menu-primary" onClick={props.onExportSaveCode}>Export code</button></div>
    <div className="menu-save-row"><div><h3>Import save code</h3><p>Restore a compatible code. Imported settings replace the corresponding values on this device.</p></div><label className="menu-stacked-field" htmlFor="menu-save-code">Save code<input id="menu-save-code" value={props.saveCodeImportInput} onChange={event=>props.onSaveCodeImportInputChange(event.target.value)} placeholder="Paste your save code" autoComplete="off"/></label><button className="menu-secondary" disabled={!props.saveCodeImportInput.trim()} onClick={()=>props.onImportSaveCode(props.saveCodeImportInput)}>Import code</button></div>
    <p className="menu-note">Save codes do not include your career statistics, replays, or account credentials.</p>
    <div className="menu-save-row menu-danger-zone"><div><h3>Reset all settings</h3><p>Restore defaults for settings, controls, appearance, custom armor, and layouts. You will review a confirmation first.</p></div><button className="menu-secondary" onClick={props.onResetAllSettings}>Review reset</button></div>
  </div>;
}
