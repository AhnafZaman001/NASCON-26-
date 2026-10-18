import { Outlet, Route, Routes } from "react-router-dom";
import Engine from "@/components/Engine";
import Shell from "@/components/Shell";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import Capture from "@/pages/Capture";
import Dashboard from "@/pages/Dashboard";
import Leads from "@/pages/Leads";
import Contacts from "@/pages/Contacts";
import ContactDetail from "@/pages/ContactDetail";
import Pipeline from "@/pages/Pipeline";
import Inbox from "@/pages/Inbox";
import Payments from "@/pages/Payments";
import Calendar from "@/pages/Calendar";
import Integrations from "@/pages/Integrations";
import Audit from "@/pages/Audit";
import Settings from "@/pages/Settings";

// Signed-in pages share the sidebar shell (it redirects to /login when logged out).
const AppLayout = () => <Shell><Outlet /></Shell>;

export default function App() {
  return (
    <Engine>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/capture" element={<Capture />} />
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/contacts/:id" element={<ContactDetail />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Home />} />
      </Routes>
    </Engine>
  );
}
