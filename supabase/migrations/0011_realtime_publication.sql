-- Tables that need live updates pushed to connected clients.
alter publication supabase_realtime add table status_posts;
alter publication supabase_realtime add table tasks;
alter publication supabase_realtime add table club_events;
alter publication supabase_realtime add table event_registrations;
