import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Layout from '@/components/Layout'
import NewGrant from '@/components/NewGrant'
import GrantPage from '@/components/GrantPage'
import Payouts from '@/components/Payouts'
import { Empty } from '@/components/ui'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<NewGrant />} />
          <Route path="grant/:id" element={<GrantPage />} />
          <Route path="payouts" element={<Payouts />} />
          <Route path="*" element={<Empty title="Page not found">Use the menu to create a grant or open your payouts.</Empty>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
