import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Store } from '../types'

export function useStores(): Store[] {
  const [stores, setStores] = useState<Store[]>([])
  useEffect(() => {
    supabase
      .from('stores')
      .select('*')
      .order('name')
      .then(({ data }) => setStores((data as Store[]) ?? []))
  }, [])
  return stores
}
