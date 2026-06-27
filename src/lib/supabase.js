import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://zdpstnmfcfbcmhtfayls.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkcHN0bm1mY2ZiY21odGZheWxzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2ODg0MzEsImV4cCI6MjA5NjI2NDQzMX0.x2iOAM4nRkRjJeP6jjTZoyoiEY0Kp3nVBlyhSl5xGBA'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
