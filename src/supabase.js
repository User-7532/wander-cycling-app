import {createClient} from '@supabase/supabase-js'

const supabaseUrl = 'https://vygnnwtxokbizejxtdyc.supabase.co'
const supabaseKey = 'sb_publishable_DmYE0dnNMKOn0zfIveJt0A__iHyIWro'

export const supabase = createClient(supabaseUrl, supabaseKey)