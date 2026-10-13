import { useState } from 'react';
import InspectionPanel from './InspectionPanel';
import AcceptancePanel from './AcceptancePanel';
import type { ComponentProps } from 'react';
export default function InspectionWorkspace(props: ComponentProps<typeof InspectionPanel>) {
  const [view,setView]=useState<'checks'|'acceptances'>('checks');
  return <><div className="panel-actions" aria-label="Mục kiểm tra"><button className="button button-quiet" aria-pressed={view==='checks'} onClick={()=>setView('checks')}>Phiếu & lỗi</button><button className="button button-quiet" aria-pressed={view==='acceptances'} onClick={()=>setView('acceptances')}>Hồ sơ nghiệm thu</button></div>
    {view==='checks'?<InspectionPanel {...props}/>:<AcceptancePanel token={props.token} user={props.user} projectId={props.projectId} systems={props.systems} onSignOut={props.onSignOut}/>}</>;
}
