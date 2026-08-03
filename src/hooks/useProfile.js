import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/supabase'

export function useProfile(userId) {
  return useQuery({
    queryKey: ['profile', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*, club_roles(label_ja, tier, is_yakuin)')
        .eq('id', userId)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!userId,
  })
}
