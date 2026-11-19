import type {Metadata} from 'next';
import AdminDashboard from './ui';
export const metadata:Metadata={title:'智域 · 内测数据看板',robots:{index:false,follow:false}};
export default function AdminPage(){return <AdminDashboard/>;}
