/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  BrowserRouter as Router, 
  Routes, 
  Route, 
  Link, 
  useParams, 
  useNavigate,
  useLocation
} from 'react-router-dom';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  onAuthStateChanged, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  getDocs,
  deleteDoc, 
  doc, 
  setDoc,
  updateDoc,
  serverTimestamp,
  User
} from './firebase';
import { 
  ChevronLeft, 
  ChevronRight, 
  Upload, 
  Trash2, 
  Calendar as CalendarIcon, 
  LogOut, 
  LogIn,
  X,
  Image as ImageIcon,
  MessageSquare,
  Save,
  Plus,
  Users
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface Photo {
  id: string;
  date: string; // YYYY-MM-DD
  imageUrl: string;
  userId: string;
  groupId: string;
  comment?: string;
  tags?: string[];
  createdAt: any;
}

interface Group {
  id: string;
  name: string;
  inviteCode: string;
  ownerId: string;
  members: string[];
  createdAt: any;
}

interface UserTags {
  userId: string;
  tags: string[];
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}

// --- Hooks ---
function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const testConnection = async () => {
      // Small delay to ensure SDK is ready
      await new Promise(resolve => setTimeout(resolve, 2000));
      try {
        const { getDocFromServer } = await import('firebase/firestore');
        await getDocFromServer(doc(db, '_connection_test', 'init'));
      } catch (error: any) {
        if (error.message?.includes('the client is offline')) {
          console.error("Firebase connection failed. Please check your configuration.");
        }
      }
    };
    testConnection();

    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const login = () => signInWithPopup(auth, googleProvider);
  const logout = () => auth.signOut();

  return { user, loading, login, logout };
}

function useGroups(userId: string | undefined) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setGroups([]);
      setLoading(false);
      return;
    }

    const q = query(collection(db, 'groups'), where('members', 'array-contains', userId));
    return onSnapshot(q, (snapshot) => {
      setGroups(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Group)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'groups');
      setLoading(false);
    });
  }, [userId]);

  return { groups, loading };
}

function usePhotos(groupId: string | undefined) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [activeDates, setActiveDates] = useState<Map<string, Photo[]>>(new Map());

  useEffect(() => {
    if (!groupId) {
      setPhotos([]);
      setActiveDates(new Map());
      return;
    }

    const path = 'photos';
    const q = query(collection(db, path), where('groupId', '==', groupId));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const p = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Photo));
      setPhotos(p);
      
      const dateMap = new Map<string, Photo[]>();
      p.forEach(photo => {
        const existing = dateMap.get(photo.date) || [];
        dateMap.set(photo.date, [...existing, photo]);
      });
      setActiveDates(dateMap);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return unsubscribe;
  }, [groupId]);

  return { photos, activeDates };
}

function useUserTags(userId: string | undefined) {
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    if (!userId) {
      setTags([]);
      return;
    }

    return onSnapshot(doc(db, 'userTags', userId), (doc) => {
      if (doc.exists()) {
        setTags(doc.data().tags || []);
      }
    });
  }, [userId]);

  const saveTag = async (newTag: string) => {
    if (!userId || !newTag || tags.includes(newTag)) return;
    const updatedTags = [...tags, newTag];
    await setDoc(doc(db, 'userTags', userId), { userId, tags: updatedTags });
  };

  const deleteTag = async (tagToDelete: string) => {
    if (!userId) return;
    const updatedTags = tags.filter(t => t !== tagToDelete);
    await setDoc(doc(db, 'userTags', userId), { userId, tags: updatedTags });
  };

  return { tags, saveTag, deleteTag };
}

// --- Components ---

const Lightbox = ({ 
  photo, 
  onClose, 
  onSaveComment, 
  onSaveTags,
  userTags,
  onSaveUserTag,
  onDeleteUserTag,
  allowComment 
}: { 
  photo: Photo, 
  onClose: () => void, 
  onSaveComment?: (id: string, comment: string) => void,
  onSaveTags?: (id: string, tags: string[]) => void,
  userTags: string[],
  onSaveUserTag: (tag: string) => void,
  onDeleteUserTag: (tag: string) => void,
  allowComment?: boolean
}) => {
  const [comment, setComment] = useState(photo.comment || '');
  const [photoTags, setPhotoTags] = useState<string[]>(photo.tags || []);
  const [newTagInput, setNewTagInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (onSaveComment) await onSaveComment(photo.id, comment);
      if (onSaveTags) await onSaveTags(photo.id, photoTags);
      setIsSaving(false);
    } catch (error) {
      console.error("Failed to save", error);
      setIsSaving(false);
    }
  };

  const toggleTag = (tag: string) => {
    setPhotoTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const handleAddNewTag = () => {
    if (newTagInput && !userTags.includes(newTagInput)) {
      onSaveUserTag(newTagInput);
      setNewTagInput('');
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4 md:p-10"
      onClick={onClose}
    >
      <button 
        onClick={onClose}
        className="absolute top-6 right-6 text-white/50 hover:text-white transition-colors p-2"
      >
        <X size={32} />
      </button>

      <div 
        className="max-w-6xl w-full flex flex-col md:flex-row gap-8 items-start"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex-1 flex items-center justify-center w-full">
          <img 
            src={photo.imageUrl} 
            alt="Full size" 
            className="max-h-[60vh] md:max-h-[85vh] w-full object-contain rounded-lg shadow-2xl"
            referrerPolicy="no-referrer"
          />
        </div>

        {allowComment && (
          <div className="w-full md:w-96 bg-white/10 backdrop-blur-xl p-6 rounded-3xl border border-white/10 overflow-y-auto max-h-[85vh]">
            <div className="flex items-center gap-2 text-amber-400 mb-4 font-bold">
              <MessageSquare size={20} />
              <span>Memories & Notes</span>
            </div>
            <textarea 
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Write a memory about this photo..."
              className="w-full h-32 bg-white/5 border border-white/10 rounded-2xl p-4 text-white placeholder:text-white/20 focus:outline-none focus:border-amber-500 transition-colors resize-none mb-6"
            />

            <div className="mb-6">
              <div className="flex items-center justify-between text-amber-400 mb-3 font-bold">
                <div className="flex items-center gap-2">
                  <ImageIcon size={18} />
                  <span>Tags</span>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-2 mb-4">
                {userTags.map(tag => (
                  <div key={tag} className="flex items-center">
                    <button 
                      onClick={() => toggleTag(tag)}
                      className={cn(
                        "px-3 py-1 rounded-full text-xs font-bold transition-all border",
                        photoTags.includes(tag) 
                          ? "bg-amber-500 border-amber-500 text-white" 
                          : "bg-white/5 border-white/10 text-white/60 hover:border-white/30"
                      )}
                    >
                      #{tag}
                    </button>
                    <button 
                      onClick={() => onDeleteUserTag(tag)}
                      className="ml-1 text-white/20 hover:text-red-400"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <input 
                  type="text"
                  value={newTagInput}
                  onChange={e => setNewTagInput(e.target.value)}
                  placeholder="New tag..."
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
                  onKeyDown={e => e.key === 'Enter' && handleAddNewTag()}
                />
                <button 
                  onClick={handleAddNewTag}
                  className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-xl transition-colors"
                >
                  <Save size={18} />
                </button>
              </div>
            </div>

            <button 
              onClick={handleSave}
              disabled={isSaving}
              className="w-full flex items-center justify-center gap-2 bg-amber-500 text-white py-3 rounded-2xl font-bold hover:bg-amber-600 transition-all disabled:opacity-30"
            >
              <Save size={20} />
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};

const Carousel = ({ photos }: { photos: Photo[] }) => {
  const navigate = useNavigate();
  if (photos.length === 0) return null;

  const handleDoubleClick = (photo: Photo) => {
    const [y, m, d] = photo.date.split('-');
    navigate(`/day/${y}/${m}/${d}`);
  };

  return (
    <div className="w-full overflow-hidden bg-amber-50/50 py-6 mb-8 border-y border-amber-100">
      <motion.div 
        className="flex gap-4 px-4"
        animate={{ x: [0, -200 * photos.length] }}
        transition={{ 
          duration: Math.max(photos.length * 4, 20), 
          repeat: Infinity, 
          ease: "linear" 
        }}
      >
        {[...photos, ...photos, ...photos].map((photo, i) => (
          <div 
            key={`${photo.id}-${i}`} 
            className="flex-shrink-0 w-64 h-40 rounded-2xl overflow-hidden shadow-sm border-2 border-white cursor-pointer"
            onDoubleClick={() => handleDoubleClick(photo)}
          >
            <img 
              src={photo.imageUrl} 
              alt="Carousel" 
              className="w-full h-full object-cover pointer-events-none"
              referrerPolicy="no-referrer"
            />
          </div>
        ))}
      </motion.div>
    </div>
  );
};

const YearView = ({ activeDates }: { activeDates: Map<string, Photo[]> }) => {
  const { year = new Date().getFullYear().toString() } = useParams();
  const navigate = useNavigate();
  const currentYear = parseInt(year);

  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const changeYear = (delta: number) => {
    const nextYear = currentYear + delta;
    if (nextYear >= 2019 && nextYear <= 2030) {
      navigate(`/year/${nextYear}`);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="flex items-center justify-between mb-12">
        <button 
          onClick={() => changeYear(-1)}
          disabled={currentYear <= 2019}
          className="p-3 hover:bg-amber-100 rounded-full disabled:opacity-20 text-amber-800 transition-colors"
        >
          <ChevronLeft size={40} />
        </button>
        <h1 className="text-6xl font-black font-sans tracking-tighter text-amber-900">{currentYear}</h1>
        <button 
          onClick={() => changeYear(1)}
          disabled={currentYear >= 2030}
          className="p-3 hover:bg-amber-100 rounded-full disabled:opacity-20 text-amber-800 transition-colors"
        >
          <ChevronRight size={40} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-8">
        {months.map(month => {
          const monthStr = month.toString().padStart(2, '0');
          const hasPhotosInMonth = Array.from(activeDates.keys()).some(d => d.startsWith(`${currentYear}-${monthStr}`));
          
          return (
            <Link 
              key={month} 
              to={`/month/${currentYear}/${monthStr}`}
              className={cn(
                "p-6 rounded-3xl border-2 transition-all hover:shadow-xl hover:-translate-y-1",
                hasPhotosInMonth 
                  ? "bg-yellow-100 border-yellow-300 shadow-yellow-100/50" 
                  : "bg-white border-amber-50 shadow-sm"
              )}
            >
              <h2 className="text-3xl font-bold mb-4 text-center text-amber-900">{monthStr}</h2>
              <div className="grid grid-cols-7 gap-1.5">
                {Array.from({ length: 31 }, (_, i) => i + 1).map(day => {
                  const dateStr = `${currentYear}-${monthStr}-${day.toString().padStart(2, '0')}`;
                  const hasPhoto = activeDates.has(dateStr);
                  return (
                    <div 
                      key={day} 
                      className={cn(
                        "w-2.5 h-2.5 rounded-full",
                        hasPhoto ? "bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.5)]" : "bg-amber-50"
                      )}
                    />
                  );
                })}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
};

const MonthView = ({ activeDates }: { activeDates: Map<string, Photo[]> }) => {
  const { year, month } = useParams();
  const navigate = useNavigate();
  
  if (!year || !month) return null;

  const firstDayOfMonth = new Date(parseInt(year), parseInt(month) - 1, 1).getDay();
  const daysInMonth = new Date(parseInt(year), parseInt(month), 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const padding = Array.from({ length: firstDayOfMonth }, (_, i) => i);

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="flex items-center gap-6 mb-10">
        <button onClick={() => navigate(`/year/${year}`)} className="p-3 hover:bg-amber-100 rounded-full text-amber-800">
          <ChevronLeft size={32} />
        </button>
        <h1 className="text-4xl font-black text-amber-900">{year} <span className="text-amber-500">/</span> {month}</h1>
      </div>

      <div className="grid grid-cols-7 gap-4">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="text-center font-bold text-amber-400 uppercase tracking-widest text-xs py-2">{d}</div>
        ))}
        {padding.map(p => <div key={`pad-${p}`} />)}
        {days.map(day => {
          const dayStr = day.toString().padStart(2, '0');
          const dateStr = `${year}-${month}-${dayStr}`;
          const dayPhotos = activeDates.get(dateStr);
          const firstPhoto = dayPhotos?.[0];

          return (
            <Link 
              key={day} 
              to={`/day/${year}/${month}/${dayStr}`}
              className={cn(
                "aspect-square flex flex-col items-center justify-center rounded-2xl border-2 transition-all hover:scale-110 hover:z-10 relative overflow-hidden",
                dayPhotos 
                  ? "border-yellow-400 shadow-md text-amber-900" 
                  : "bg-white border-amber-50 text-amber-800"
              )}
            >
              {firstPhoto && (
                <div 
                  className="absolute inset-0 z-0 opacity-60"
                  style={{
                    backgroundImage: `url(${firstPhoto.imageUrl})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center'
                  }}
                />
              )}
              <span className="text-2xl font-black relative z-10">{day}</span>
              {dayPhotos && <ImageIcon size={20} className="text-yellow-600 mt-1 relative z-10" />}
            </Link>
          );
        })}
      </div>
    </div>
  );
};

const GroupManager = ({ 
  groups, 
  onSelect, 
  currentGroupId, 
  userId 
}: { 
  groups: Group[], 
  onSelect: (id: string) => void, 
  currentGroupId: string | null,
  userId: string
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const handleCreate = async () => {
    if (!name) return;
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const newGroup = {
      name,
      inviteCode: code,
      ownerId: userId,
      members: [userId],
      createdAt: serverTimestamp()
    };
    const docRef = await addDoc(collection(db, 'groups'), newGroup);
    onSelect(docRef.id);
    setIsCreating(false);
    setName('');
  };

  const handleJoin = async () => {
    if (!inviteCode) return;
    const q = query(collection(db, 'groups'), where('inviteCode', '==', inviteCode.toUpperCase()));
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      const groupDoc = snapshot.docs[0];
      const groupData = groupDoc.data() as Group;
      if (!groupData.members.includes(userId)) {
        await updateDoc(doc(db, 'groups', groupDoc.id), {
          members: [...groupData.members, userId]
        });
      }
      onSelect(groupDoc.id);
      setIsJoining(false);
      setInviteCode('');
    } else {
      alert("Invalid invite code");
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 mb-8">
      <div className="flex flex-wrap gap-4 items-center">
        {groups.map(g => (
          <button 
            key={g.id}
            onClick={() => onSelect(g.id)}
            className={cn(
              "px-6 py-3 rounded-2xl font-bold transition-all border-2",
              currentGroupId === g.id 
                ? "bg-amber-500 border-amber-500 text-white shadow-lg shadow-amber-200" 
                : "bg-white border-amber-100 text-amber-900 hover:border-amber-300"
            )}
          >
            {g.name}
          </button>
        ))}
        <button 
          onClick={() => setIsCreating(true)}
          className="p-3 bg-white border-2 border-dashed border-amber-200 rounded-2xl text-amber-400 hover:border-amber-400 hover:text-amber-600 transition-all"
          title="Create Group"
        >
          <Plus size={24} />
        </button>
        <button 
          onClick={() => setIsJoining(true)}
          className="p-3 bg-white border-2 border-dashed border-amber-200 rounded-2xl text-amber-400 hover:border-amber-400 hover:text-amber-600 transition-all"
          title="Join Group"
        >
          <Users size={24} />
        </button>
      </div>

      <AnimatePresence>
        {isCreating && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-6 bg-white p-6 rounded-3xl border-2 border-amber-100 shadow-xl overflow-hidden"
          >
            <h3 className="text-xl font-black text-amber-900 mb-4">Create New Group</h3>
            <div className="flex gap-4">
              <input 
                type="text" 
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Group Name"
                className="flex-1 bg-amber-50 border-2 border-amber-100 rounded-2xl px-6 py-3 focus:outline-none focus:border-amber-500"
              />
              <button 
                onClick={handleCreate}
                className="bg-amber-500 text-white px-8 py-3 rounded-2xl font-bold hover:bg-amber-600 transition-all"
              >
                Create
              </button>
              <button onClick={() => setIsCreating(false)} className="px-4 text-amber-400 font-bold">Cancel</button>
            </div>
          </motion.div>
        )}

        {isJoining && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-6 bg-white p-6 rounded-3xl border-2 border-amber-100 shadow-xl overflow-hidden"
          >
            <h3 className="text-xl font-black text-amber-900 mb-4">Join Group</h3>
            <div className="flex gap-4">
              <input 
                type="text" 
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value)}
                placeholder="Invite Code"
                className="flex-1 bg-amber-50 border-2 border-amber-100 rounded-2xl px-6 py-3 focus:outline-none focus:border-amber-500 uppercase"
              />
              <button 
                onClick={handleJoin}
                className="bg-amber-500 text-white px-8 py-3 rounded-2xl font-bold hover:bg-amber-600 transition-all"
              >
                Join
              </button>
              <button onClick={() => setIsJoining(false)} className="px-4 text-amber-400 font-bold">Cancel</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {currentGroupId && groups.find(g => g.id === currentGroupId) && (
        <div className="mt-4 text-sm font-bold text-amber-400 flex items-center gap-2">
          <Users size={16} />
          Invite Code: <span className="text-amber-600 bg-amber-100 px-2 py-0.5 rounded-lg">{groups.find(g => g.id === currentGroupId)?.inviteCode}</span>
        </div>
      )}
    </div>
  );
};

const DayView = ({ user, groupId, onPhotoDoubleClick }: { user: User, groupId: string, onPhotoDoubleClick: (p: Photo) => void }) => {
  const { year, month, day } = useParams();
  const navigate = useNavigate();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dateStr = `${year}-${month}-${day}`;

  useEffect(() => {
    const path = 'photos';
    const q = query(
      collection(db, path), 
      where('groupId', '==', groupId),
      where('date', '==', dateStr)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setPhotos(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Photo)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
    return unsubscribe;
  }, [groupId, dateStr]);

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1200;
          const MAX_HEIGHT = 1200;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
      };
    });
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const compressedBase64 = await compressImage(file);
      await addDoc(collection(db, 'photos'), {
        date: dateStr,
        imageUrl: compressedBase64,
        userId: user.uid,
        groupId: groupId,
        createdAt: serverTimestamp()
      });
      setUploading(false);
    } catch (error) {
      console.error("Upload failed", error);
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'photos', id));
    } catch (error) {
      console.error("Delete failed", error);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="flex items-center justify-between mb-10">
        <div className="flex items-center gap-6">
          <button onClick={() => navigate(`/month/${year}/${month}`)} className="p-3 hover:bg-amber-100 rounded-full text-amber-800">
            <ChevronLeft size={32} />
          </button>
          <h1 className="text-4xl font-black text-amber-900">{dateStr}</h1>
        </div>
        <button 
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 bg-amber-500 text-white px-6 py-3 rounded-2xl hover:bg-amber-600 transition-all shadow-lg shadow-amber-200 disabled:opacity-50 font-bold"
        >
          <Upload size={24} />
          {uploading ? 'Uploading...' : 'Add Photo'}
        </button>
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleUpload} 
          className="hidden" 
          accept="image/*"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-8">
        <AnimatePresence>
          {photos.map(photo => (
            <motion.div 
              key={photo.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="group relative aspect-square rounded-3xl overflow-hidden shadow-xl border-4 border-white cursor-zoom-in"
              onDoubleClick={() => onPhotoDoubleClick(photo)}
            >
              <img 
                src={photo.imageUrl} 
                alt="Daily" 
                className="w-full h-full object-cover pointer-events-none"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity" />
              <button 
                onClick={(e) => { e.stopPropagation(); handleDelete(photo.id); }}
                className="absolute top-4 right-4 p-3 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all hover:bg-red-600 hover:scale-110 shadow-lg z-20"
              >
                <Trash2 size={20} />
              </button>
              {(photo.comment || (photo.tags && photo.tags.length > 0)) && (
                <div className="absolute bottom-4 left-4 right-4 bg-black/40 backdrop-blur-md p-2 rounded-xl text-white text-xs">
                  <div className="line-clamp-1">{photo.comment}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {photo.tags?.map(t => <span key={t} className="text-[10px] bg-amber-500/50 px-1 rounded">#{t}</span>)}
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {photos.length === 0 && !uploading && (
          <div className="col-span-full py-32 text-center">
            <div className="bg-amber-50 w-32 h-32 rounded-full flex items-center justify-center mx-auto mb-6">
              <ImageIcon size={48} className="text-amber-200" />
            </div>
            <p className="text-amber-900/40 font-medium text-xl">No photos captured for this day.</p>
          </div>
        )}
      </div>
    </div>
  );
};

const Navigation = ({ user, logout, login }: { user: User | null, logout: () => void, login: () => void }) => {
  return (
    <nav className="bg-white/80 backdrop-blur-md sticky top-0 z-50 border-b border-amber-100">
      <div className="max-w-6xl mx-auto px-4 h-20 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 text-2xl font-black text-amber-600">
          <div className="bg-amber-500 p-2 rounded-xl text-white">
            <CalendarIcon size={28} />
          </div>
          <span className="tracking-tighter">PHOTO CALENDAR</span>
        </Link>
        
        {user ? (
          <div className="flex items-center gap-6">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-sm font-bold text-amber-900">{user.displayName}</span>
              <span className="text-xs text-amber-500 font-medium">{user.email}</span>
            </div>
            <img src={user.photoURL || ''} alt="Avatar" className="w-10 h-10 rounded-2xl border-2 border-amber-200 shadow-sm" />
            <button 
              onClick={logout}
              className="p-2.5 hover:bg-red-50 rounded-xl text-red-400 hover:text-red-600 transition-all"
              title="Logout"
            >
              <LogOut size={24} />
            </button>
          </div>
        ) : (
          <button 
            onClick={login}
            className="flex items-center gap-2 bg-amber-500 text-white px-6 py-2.5 rounded-2xl hover:bg-amber-600 transition-all font-bold shadow-lg shadow-amber-100"
          >
            <LogIn size={20} />
            Sign In
          </button>
        )}
      </div>
    </nav>
  );
};

export default function App() {
  const { user, loading: authLoading, login, logout } = useAuth();
  const { groups, loading: groupsLoading } = useGroups(user?.uid);
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null);
  const { photos, activeDates } = usePhotos(currentGroupId || undefined);
  const { tags: userTags, saveTag, deleteTag } = useUserTags(user?.uid);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);

  useEffect(() => {
    if (groups.length > 0 && !currentGroupId) {
      setCurrentGroupId(groups[0].id);
    }
  }, [groups, currentGroupId]);

  const handleSaveComment = async (id: string, comment: string) => {
    try {
      await updateDoc(doc(db, 'photos', id), { comment });
      setSelectedPhoto(prev => prev ? { ...prev, comment } : null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'photos');
    }
  };

  const handleSaveTags = async (id: string, tags: string[]) => {
    try {
      await updateDoc(doc(db, 'photos', id), { tags });
      setSelectedPhoto(prev => prev ? { ...prev, tags } : null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'photos');
    }
  };

  if (authLoading || groupsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="rounded-full h-16 w-16 border-4 border-amber-100 border-t-amber-500"
        />
      </div>
    );
  }

  return (
    <Router>
      <div className="min-h-screen bg-[#FFFDF9] font-sans text-amber-950">
        <Navigation user={user} logout={logout} login={login} />
        
        <AnimatePresence>
          {selectedPhoto && (
            <Lightbox 
              photo={selectedPhoto} 
              onClose={() => setSelectedPhoto(null)} 
              onSaveComment={handleSaveComment}
              onSaveTags={handleSaveTags}
              userTags={userTags}
              onSaveUserTag={saveTag}
              onDeleteUserTag={deleteTag}
              allowComment={window.location.pathname.includes('/day/')}
            />
          )}
        </AnimatePresence>

        {!user ? (
          <div className="max-w-2xl mx-auto mt-24 p-12 text-center bg-white rounded-[40px] shadow-2xl shadow-amber-100 border border-amber-50">
            <div className="bg-amber-100 w-24 h-24 rounded-3xl flex items-center justify-center mx-auto mb-8 rotate-3">
              <CalendarIcon size={48} className="text-amber-600" />
            </div>
            <h1 className="text-5xl font-black mb-6 tracking-tight text-amber-900">Your Life, <br/>Day by Day.</h1>
            <p className="text-amber-700/70 mb-10 text-xl font-medium leading-relaxed">
              A warm space to collect your daily memories. <br/>Start your photo journey from 2019 to 2030.
            </p>
            <button 
              onClick={login}
              className="inline-flex items-center gap-4 bg-amber-500 text-white px-10 py-5 rounded-[24px] text-2xl font-black hover:bg-amber-600 transition-all hover:scale-105 shadow-xl shadow-amber-200"
            >
              <LogIn size={28} />
              Login with Google
            </button>
          </div>
        ) : (
          <main className="pb-24">
            <GroupManager 
              groups={groups} 
              onSelect={setCurrentGroupId} 
              currentGroupId={currentGroupId}
              userId={user.uid}
            />

            {currentGroupId ? (
              <Routes>
                <Route path="/" element={
                  <>
                    <Carousel photos={photos} />
                    <YearView activeDates={activeDates} />
                  </>
                } />
                <Route path="/year/:year" element={
                  <>
                    <Carousel photos={photos} />
                    <YearView activeDates={activeDates} />
                  </>
                } />
                <Route path="/month/:year/:month" element={<MonthView activeDates={activeDates} />} />
                <Route path="/day/:year/:month/:day" element={<DayView user={user} groupId={currentGroupId} onPhotoDoubleClick={setSelectedPhoto} />} />
              </Routes>
            ) : (
              <div className="max-w-xl mx-auto mt-20 text-center p-12 bg-white rounded-[40px] border-2 border-amber-50 shadow-xl">
                <div className="bg-amber-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Users size={40} className="text-amber-200" />
                </div>
                <h2 className="text-3xl font-black text-amber-900 mb-4">No Group Selected</h2>
                <p className="text-amber-700/60 font-medium mb-8">Create or join a group to start sharing your calendar memories with others.</p>
              </div>
            )}
          </main>
        )}
      </div>
    </Router>
  );
}
